import {test} from 'node:test';import assert from 'node:assert/strict';
import {materialSnapshot} from '../dist/material-snapshot.js';
import {colleagueMentionSource} from '../dist/colleague-mentions.js';
const text=text=>[{type:'text',text}];
const events=[
 {type:'system/message',seq:0,data:{message:{content:text('private secret')}}},
 {type:'user/message',seq:1,data:{source:{kind:'user'},content:[...text('分析 Excel'),{type:'file',attachment:{attachmentId:'hash',name:'a.xlsx',bytes:50}}]}},
 {type:'assistant/message',seq:2,data:{message:{content:[{type:'reasoning',text:'private reasoning'},{type:'tool-call',id:'x',name:'read',arguments:{}}]}}},
 {type:'tool/result',seq:3,data:{content:text('private tool payload')}},
 {type:'assistant/message',seq:4,data:{message:{content:text('总额 960')}}},
];
test('snapshot contains public final text and original files, excludes private system/tool/reasoning',()=>{
 const snapshot=materialSnapshot(events);assert.match(snapshot.context,/总额 960/);assert.match(snapshot.context,/分析 Excel/);
 assert.doesNotMatch(snapshot.context,/private/);assert.equal(snapshot.files[0].name,'a.xlsx');
 assert.throws(()=>materialSnapshot(events.slice(0,4)),/完整分析/);
 assert.equal(materialSnapshot([...events,{type:'assistant/message',seq:5,data:{interrupted:true,message:{content:text('incomplete')}}}]).seq,4);
});
test('selecting recipient claims native handoff command, send action receives exact member and optional note',async()=>{
 let called;
 const source=colleagueMentionSource(async()=>[],async(...args)=>{called=args;return 'sent';});
 const result=source.onPick({candidate:{value:'b',name:'b@example.test',label:'同事 B'},session:{sessionId:'s'}});
 assert.equal(called,undefined);assert.equal(result.claim.attachments,false);
 assert.equal((await result.claim.submit('',{},[])).kind,'success');assert.deepEqual(called,['s','b','同事 B','']);
});

test('material handoff streams original bytes and handles the official sha256-prefixed attachment ID',async()=>{
 const {installMaterials}=await import('../dist/material-host.js');
 const {createHash}=await import('node:crypto');
 const bytes=Buffer.from('original workbook bytes');const digest=createHash('sha256').update(bytes).digest('hex');
 const file={attachmentId:`sha256:${digest}`,name:'source.xlsx',bytes:bytes.length};
 let route,bundle;const conversations=new Map();
 const ctx={inject(_services,callback){callback(this);},effect(callback){callback();},
  workdshIdentity:{},connection:{fetch:{register(value){if(value.path==='/api/workdsh-collaboration-materials')route=value;return()=>{};}}},tools:{register(){return()=>{};}},
  sessionController:{async inspect(){return{events:[{type:'user/message',seq:1,data:{source:{kind:'user'},content:[...text('核对'),{type:'file',attachment:file}]}},{type:'assistant/message',seq:2,data:{message:{content:text('已核对')}}}]};}},
  attachments:{async *readFileStream(){yield bytes.subarray(0,5);yield bytes.subarray(5);}}};
 const client={async verify(){},async colleagues(){return[{id:'b'}];},async sendMaterials(_identity,value){bundle=value;return{id:'handoff'};}};
 installMaterials(ctx,client,conversations);
 const call=async body=>(await route.fetch(new Request('http://localhost/api/workdsh-collaboration-materials',{method:'POST',body:JSON.stringify(body)}))).json();
 const preview=await call({action:'prepare',sessionId:'session'});assert.equal(preview.ok,true);
 const result=await call({action:'send',token:preview.value.token,recipientId:'b',files:[file.attachmentId]});
 assert.equal(result.ok,true);assert.equal(bundle.files[0].sha256,digest);
 assert.deepEqual(Buffer.from(bundle.files[0].data,'base64'),bytes);assert.equal(conversations.get('handoff'),'session');
});

test('only formally presented files in the latest completed analysis are selected as generated outcomes',()=>{
 const sample=[...events.slice(0,4),{type:'deliverables/presented',seq:3.5,data:{files:[{path:'output/report.docx'},{path:'output/report.docx'}]}},events[4],{type:'deliverables/presented',seq:5,data:{files:[{path:'unfinished.docx'}]}}];
 assert.deepEqual(materialSnapshot(sample).generated,[{path:'output/report.docx'}]);
 assert.deepEqual(materialSnapshot(events).generated,[]);
});

test('generated outcomes are read through the scoped filesystem, frozen in attachments and downloaded without invoking AI',async()=>{
 const {installMaterials}=await import('../dist/material-host.js');const {createHash}=await import('node:crypto');
 const bytes=Buffer.from('generated docx');const digest=createHash('sha256').update(bytes).digest('hex');
 const routes=new Map();let bundle;let inside=true;let resolveCount=0;
 const ctx={inject(_services,callback){callback(this);},effect(callback){callback();},workdshIdentity:{},
  connection:{fetch:{register(route){routes.set(route.path,route);return()=>{};}}},tools:{register(){return()=>{};}},
  sessionController:{async inspect(){return{meta:{cwd:'/workspace'},events:[events[1],{type:'deliverables/presented',seq:2,data:{files:[{path:'output/report.docx'}]}},events[4]]};},async resolveAgent(){resolveCount++;return{agent:{ctx:{get fs(){throw new Error('cannot get property fs without inject');},get(name){assert.equal(name,'fs');return {async resolve(path){return path;},contains(){return inside;},async readBytes(){return bytes;}};}}}};}},
  attachments:{async saveFile(){return{attachmentId:`sha256:${digest}`,name:'report.docx',bytes:bytes.length};},async *readFileStream(){yield bytes;}}};
 const client={async verify(){},async colleagues(){return[{id:'b'}];},async sendMaterials(_identity,value){bundle=value;return{id:'share'};},async materials(_identity,id){if(id==='denied')throw new Error('denied');return{context:'analysis',files:[{name:'report.docx',sha256:digest,data:bytes.toString('base64')}]};}};
 installMaterials(ctx,client,new Map());
 const post=async body=>(await routes.get('/api/workdsh-collaboration-materials').fetch(new Request('http://localhost/',{method:'POST',body:JSON.stringify(body)}))).json();
 const preview=await post({action:'prepare',sessionId:'s'});assert.equal(preview.ok,true);
 assert.equal(preview.value.files.find(file=>file.name==='report.docx').kind,'生成成果');
 const selected=preview.value.files.filter(file=>file.kind==='生成成果').map(file=>file.id);
 assert.equal((await post({action:'send',token:preview.value.token,recipientId:'b',files:selected})).ok,true);
 assert.equal(bundle.files[0].name,'report.docx');assert.deepEqual(Buffer.from(bundle.files[0].data,'base64'),bytes);
 const before=resolveCount;assert.equal((await post({action:'view',handoffId:'share'})).value.files[0].name,'report.docx');assert.equal(resolveCount,before,'view must not activate an Agent');
 const route=routes.get('/api/workdsh-collaboration-file');const response=await route.fetch(new Request('http://localhost/?handoffId=share&index=0'));
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.match(response.headers.get('content-disposition'),/report.docx/);
 assert.equal((await route.fetch(new Request('http://localhost/?handoffId=denied&index=0'))).status,404);
 inside=false;assert.equal((await post({action:'prepare',sessionId:'s'})).ok,false,'external presented paths must be rejected');
});
