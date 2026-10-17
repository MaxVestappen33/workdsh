import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryOriginalPanelClient,returnToLibraryPanel} from '../dist/client/original-panel.js';
function fixture({session=true,mintAfter=0}={}){
 let mounted,attempts=0,activePanel='quality',connected=0;
 const calls=[],disposals=[];
 const ctx={effect(run){disposals.push(run());},slots:{entriesOfSlot(){return [{options:{key:'quality'}}];}},
  sessions:{list:{getSnapshot(){return {byId:session?{real:{id:'real-session',retainedBy:{mainView:1}}}:{}};}}},
  workspaces:{list:{getSnapshot(){return {items:[{workspaceId:'real-workspace'}]};}}},
  uiWorkspace:{openSession(id){calls.push(['session',id]);mounted=id;},async connectWorkspace(id){connected++;calls.push(['connect',id]);return 'new-real-session';}},
  layout:{selectPanel(id){activePanel=id;calls.push(['panel',id]);},panelInfo:{getSnapshot(){return {activePanelId:activePanel};}}},
  sidebarRight:{mounted:{getSnapshot(){return mounted;}},openTab(kind,options){attempts++;if(attempts<=mintAfter)throw Error('seat-not-yet-minted');calls.push(['tab',kind,options]);}}};
 return {ctx,calls,get connected(){return connected;},get attempts(){return attempts;},dispose(){disposals.forEach(fn=>fn?.());},switchPanel(){activePanel='other';},switchSession(){mounted='another';}};
}
const input={assetId:'asset',revisionId:'fixed-revision',name:'检验.csv',kind:'csv',returnPanel:{id:'quality',label:'返回质量分析'}};
test('opens only in a real selected Session through public navigation; pinned revision and JSON return route survive',async()=>{
 const f=fixture();await createLibraryOriginalPanelClient(f.ctx).open(input);
 assert.deepEqual(f.calls,[['session','real-session'],['panel',null],['tab','workdsh-library-preview',{params:{assetId:'asset',revisionId:'fixed-revision',name:'检验.csv',kind:'csv',returnPanelId:'quality',returnLabel:'返回质量分析'}}]]);
 assert.equal(f.connected,0);f.dispose();
});
test('no selected Session uses the official Workspace connection; XLSX explicitly enables owner save',async()=>{
 const f=fixture({session:false});await createLibraryOriginalPanelClient(f.ctx).open({...input,kind:'xlsx'});
 assert.equal(f.connected,1);assert.deepEqual(f.calls[0],['connect','real-workspace']);assert.deepEqual(f.calls[1],['session','new-real-session']);assert.equal(f.calls.at(-1)[2].params.saveOriginal,true);f.dispose();
});
test('invalid or absent return panel fails before changing navigation',async()=>{
 const f=fixture();await assert.rejects(createLibraryOriginalPanelClient(f.ctx).open({...input,returnPanel:{id:'not-registered',label:'返回'}}),/工作台暂时不可用/);assert.equal(f.calls.length,0);f.dispose();
});
test('waits for official seat readiness and never fabricates Session stores',async()=>{
 const f=fixture({mintAfter:2});await createLibraryOriginalPanelClient(f.ctx).open(input);assert.equal(f.attempts,3);assert.equal(f.calls.at(-1)[0],'tab');f.dispose();
});
test('external cancellation stops readiness retries without claiming an opened tab',async()=>{
 const f=fixture({mintAfter:100}),controller=new AbortController();const pending=createLibraryOriginalPanelClient(f.ctx).open(input,controller.signal);controller.abort();await assert.rejects(pending);assert.equal(f.calls.filter(row=>row[0]==='tab').length,0);assert.equal(f.attempts,1);f.dispose();
});
test('a later user navigation cancels pending right-panel open',async()=>{
 const f=fixture({mintAfter:100});const pending=createLibraryOriginalPanelClient(f.ctx).open(input);f.switchPanel();await assert.rejects(pending,/已切换页面/);assert.equal(f.calls.filter(row=>row[0]==='tab').length,0);f.dispose();
});
test('unload cancels pending retries, and return route rechecks registered main panel',async()=>{
 const f=fixture({mintAfter:100});const pending=createLibraryOriginalPanelClient(f.ctx).open(input);f.dispose();await assert.rejects(pending);assert.throws(()=>returnToLibraryPanel(f.ctx,'missing'),/暂时不可用/);returnToLibraryPanel(f.ctx,'quality');assert.deepEqual(f.calls.at(-1),['panel','quality']);
});
