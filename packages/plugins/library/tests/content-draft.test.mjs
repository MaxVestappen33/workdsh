import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const webRequire=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const libraryRequire=createRequire(new URL('../package.json',import.meta.url));
const {build}=webRequire('esbuild');
const built=await build({
 stdin:{contents:"export {LibraryManager} from './library-manager';export {libraryStateSchema} from '../storage/domain';",resolveDir:fileURLToPath(new URL('../src/services/',import.meta.url)),loader:'ts'},
 bundle:true,platform:'node',format:'esm',write:false,
 plugins:[{name:'published-runtime-owner',setup(builder){
  builder.onResolve({filter:/^(?:@deepseek-ai\/cordis|@deepseek-ai\/dsh-storage-domain|zod|workdsh-tabular|jszip|pdfjs-dist(?:\/.*)?)$/},args=>({path:pathToFileURL(libraryRequire.resolve(args.path)).href,external:true}));
 }}],
});
const bundleRoot=await mkdtemp(join(tmpdir(),'library-content-draft-bundle-'));
after(()=>rm(bundleRoot,{recursive:true,force:true}));
const bundlePath=join(bundleRoot,'library-content-draft.mjs');await writeFile(bundlePath,built.outputFiles[0].text);
const {LibraryManager,libraryStateSchema}=await import(pathToFileURL(bundlePath).href);
const load=name=>import(pathToFileURL(libraryRequire.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');
const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const JsonStorage=await load('@deepseek-ai/dsh-storage-json');
const StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
const actor={principalId:'member.a',organizationId:'org',requestId:'draft-test',resolvedBy:'trusted-fixture'};
const hash=content=>createHash('sha256').update(content).digest('hex');
const create=(draftId='report-draft',content='分析\n结论\n建议',operationId='create')=>({draftId,content,operationId});

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'library-content-draft-'));
 const f={root};
 async function open(){
  f.ctx=new Context();await f.ctx.plugin(Storage);await f.ctx.plugin(JsonStorage,{root:join(root,'storage')});await f.ctx.plugin(StorageDomain,{backend:'json'});
  await f.ctx.plugin(LibraryManager,{root:join(root,'library')});f.library=f.ctx.workdshLibrary;
 }
 f.close=async()=>{await f.ctx?.fiber.dispose();f.ctx=undefined;};
 f.reopen=async()=>{await f.close();await open();};
 t.after(async()=>{await f.close();await rm(root,{recursive:true,force:true});});await open();return f;
}

test('detached content persists across real JSON restart without creating an asset, including archived body',async t=>{
 const f=await fixture(t),first=await f.library.saveContentDraft(actor,create());
 assert.equal(first.sha256,hash(first.content));assert.equal(first.status,'active');assert.equal(first.createdBy,actor.principalId);
 assert.deepEqual(await f.library.list(actor),[]);
 const second=await f.library.saveContentDraft(actor,{...create('report-draft','追加质量结论','edit'),expectedRevision:first.revision});
 assert.notEqual(second.revision,first.revision);assert.equal(second.createdAt,first.createdAt);
 await f.reopen();assert.deepEqual(await f.library.readContentDraft(actor,first.id),second);
 const archived=await f.library.archiveContentDraft(actor,{draftId:first.id,expectedRevision:second.revision,operationId:'archive'});
 assert.equal(archived.content,second.content);assert.equal(archived.sha256,second.sha256);assert.equal(archived.status,'archived');assert.notEqual(archived.revision,second.revision);
 await f.reopen();assert.deepEqual(await f.library.readContentDraft(actor,first.id),archived);
 assert.deepEqual(await f.library.archiveContentDraft(actor,{draftId:first.id,expectedRevision:second.revision,operationId:'archive'}),archived);
 await assert.rejects(f.library.saveContentDraft(actor,{...create('report-draft','不应恢复','after-archive'),expectedRevision:archived.revision}),/content-draft-archived/);
});

test('legacy asset-bound draft publication retains its existing contract',async t=>{
 const f=await fixture(t);
 const original=await f.library.importAsset(actor,{name:'legacy.md',bytes:new TextEncoder().encode('# 原正文'),operationId:'legacy-import'});
 const first=await f.library.createDraft(actor,original.asset.id,original.revision.id);
 const concurrent=await f.library.createDraft(actor,original.asset.id,original.revision.id);
 assert.notEqual(first.id,concurrent.id);assert.equal(first.baseRevisionId,original.revision.id);
 const edited=await f.library.updateDraft(actor,first.id,'# 新正文',first.revision);
 await assert.rejects(f.library.updateDraft(actor,first.id,'stale',first.revision),/library\/revision-conflict/);
 const published=await f.library.publishDraft(actor,first.id,edited.revision);
 assert.equal(published.revision.number,2);assert.equal(new TextDecoder().decode(await f.library.readOriginal(actor,original.asset.id)),'# 新正文');
 await assert.rejects(f.library.publishDraft(actor,concurrent.id,concurrent.revision),/library\/base-revision-conflict/);
 const state=f.library.states().get(f.library.key(actor));assert.deepEqual(state.contentDrafts,{});assert.deepEqual(state.contentDraftReceipts,{});
});

test('no-change save reuses revision, while a superseded operation never rewrites current content',async t=>{
 const f=await fixture(t),input=create(),first=await f.library.saveContentDraft(actor,input);
 assert.deepEqual(await f.library.saveContentDraft(actor,input),first);
 const same=await f.library.saveContentDraft(actor,{...input,operationId:'same',expectedRevision:first.revision});
 assert.equal(same.revision,first.revision);assert.equal(same.updatedAt,first.updatedAt);assert.equal(same.operationId,'same');
 assert.deepEqual(await f.library.saveContentDraft(actor,{...input,operationId:'same',expectedRevision:first.revision}),same);
 const second=await f.library.saveContentDraft(actor,{...input,content:'new text',expectedRevision:same.revision,operationId:'edit'});
 await assert.rejects(f.library.saveContentDraft(actor,input),/content-draft-operation-superseded/);
 await assert.rejects(f.library.saveContentDraft(actor,{...input,operationId:'same',expectedRevision:first.revision}),/content-draft-operation-superseded/);
 assert.deepEqual(await f.library.readContentDraft(actor,input.draftId),second);
});

test('create, update and archive recover committed writes after an acknowledgement is lost',async t=>{
 const f=await fixture(t);await f.library.space(actor);
 const table=f.library.states(),put=table.put.bind(table);
 async function loseAck(work){table.put=async(...args)=>{await put(...args);throw Error('lost-storage-ack');};try{await assert.rejects(work(),/lost-storage-ack/);}finally{table.put=put;}}
 const input=create();await loseAck(()=>f.library.saveContentDraft(actor,input));
 const first=await f.library.saveContentDraft(actor,input);
 const update={...input,content:'updated after lost ack',expectedRevision:first.revision,operationId:'update'};
 await loseAck(()=>f.library.saveContentDraft(actor,update));const second=await f.library.saveContentDraft(actor,update);
 assert.notEqual(second.revision,first.revision);assert.equal(second.content,update.content);
 const archive={draftId:first.id,expectedRevision:second.revision,operationId:'archive'};
 await loseAck(()=>f.library.archiveContentDraft(actor,archive));const archived=await f.library.archiveContentDraft(actor,archive);
 await f.reopen();assert.deepEqual(await f.library.archiveContentDraft(actor,archive),archived);
 assert.deepEqual(await f.library.readContentDraft(actor,first.id),archived);
});

test('a rejected write before commit can retry the same intent without a phantom version',async t=>{
 const f=await fixture(t);await f.library.space(actor);const table=f.library.states(),put=table.put.bind(table);
 table.put=async()=>{throw Error('before-storage-commit');};await assert.rejects(f.library.saveContentDraft(actor,create()),/before-storage-commit/);table.put=put;
 await assert.rejects(f.library.readContentDraft(actor,'report-draft'),/content-draft-not-found/);
 const first=await f.library.saveContentDraft(actor,create());assert.deepEqual(await f.library.saveContentDraft(actor,create()),first);
});

test('CAS permits one concurrent update, rejects stale bases and operation/content reuse',async t=>{
 const f=await fixture(t),first=await f.library.saveContentDraft(actor,create());
 const outcomes=await Promise.allSettled(['a','b'].map(operationId=>f.library.saveContentDraft(actor,{draftId:first.id,content:operationId,operationId,expectedRevision:first.revision})));
 assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);
 assert.match(outcomes.find(value=>value.status==='rejected').reason.message,/content-draft-revision-conflict/);
 await assert.rejects(f.library.saveContentDraft(actor,{...create(),content:'same op different text'}),/content-draft-operation-conflict/);
 await assert.rejects(f.library.saveContentDraft(actor,create('other-draft','分析\n结论\n建议')),/content-draft-operation-conflict/);
 await assert.rejects(f.library.archiveContentDraft(actor,{draftId:first.id,expectedRevision:first.revision,operationId:'create'}),/content-draft-operation-conflict/);
 await assert.rejects(f.library.saveContentDraft(actor,create(first.id,'overwrite without base','new-create')),/content-draft-revision-conflict/);
});

test('owner space and legacy key collisions cannot expose another owner content',async t=>{
 const f=await fixture(t),first=await f.library.saveContentDraft(actor,create());
 await assert.rejects(f.library.readContentDraft({...actor,principalId:'other-member'},first.id),/content-draft-not-found/);
 await assert.rejects(f.library.readContentDraft({...actor,organizationId:'other-org'},first.id),/content-draft-not-found/);
 await assert.rejects(f.library.readContentDraft({...actor,principalId:'member-a'},first.id),/library\/owner-mismatch/);
 const other=await f.library.saveContentDraft({...actor,principalId:'other-member'},create(first.id,'other owner'));
 assert.equal(other.content,'other owner');assert.equal((await f.library.readContentDraft(actor,first.id)).content,first.content);
});

test('write-before identity guard and cancellation reject save/archive without persisting changes',async t=>{
 const f=await fixture(t),first=await f.library.saveContentDraft(actor,create());
 const ensure=f.library.ensureState.bind(f.library);let authorized=true;
 f.library.ensureState=async(...args)=>{const state=await ensure(...args);authorized=false;return state;};
 const guard=()=>{if(!authorized)throw Error('actor-revoked-before-write');};
 await assert.rejects(f.library.saveContentDraft(actor,{...create(first.id,'unauthorized','revoked'),expectedRevision:first.revision},undefined,guard),/actor-revoked-before-write/);
 authorized=true;await assert.rejects(f.library.archiveContentDraft(actor,{draftId:first.id,expectedRevision:first.revision,operationId:'revoked-archive'},undefined,guard),/actor-revoked-before-write/);
 f.library.ensureState=ensure;assert.deepEqual(await f.library.readContentDraft(actor,first.id),first);
 const controller=new AbortController();f.library.ensureState=async(...args)=>{const state=await ensure(...args);controller.abort();return state;};
 await assert.rejects(f.library.saveContentDraft(actor,{...create(first.id,'cancelled','cancelled'),expectedRevision:first.revision},controller.signal),{name:'AbortError'});
 f.library.ensureState=ensure;assert.deepEqual(await f.library.readContentDraft(actor,first.id),first);
});

test('detached drafts respect byte, owner-count and operation budgets; old JSON gains empty defaults',async t=>{
 const f=await fixture(t);await f.library.space(actor);
 const state=f.library.states().get(f.library.key(actor)),{contentDrafts,contentDraftReceipts,...legacy}=state;
 const parsed=libraryStateSchema.parse(legacy);assert.deepEqual(parsed.contentDrafts,{});assert.deepEqual(parsed.contentDraftReceipts,{});
 await f.library.states().put(f.library.key(actor),legacy);await f.reopen();
 const exact='质'.repeat(5461)+'a';assert.equal(Buffer.byteLength(exact,'utf8'),16*1024);
 const first=await f.library.saveContentDraft(actor,create('max-body',exact,'max-body'));
 await assert.rejects(f.library.saveContentDraft(actor,create('too-large',exact+'a','too-large')),/content-draft-size-limit/);
 await assert.rejects(f.library.saveContentDraft(actor,create('__proto__','bad','prototype')),/content-draft-invalid-input/);
 await assert.rejects(f.library.saveContentDraft(actor,create('surrogate','\ud800','surrogate')),/content-draft-invalid-content/);
 const table=f.library.states(),current=table.get(f.library.key(actor));
 const drafts={...current.contentDrafts};for(let i=1;i<100;i++)drafts[`draft-${i}`]={...first,id:`draft-${i}`};
 await table.put(f.library.key(actor),{...current,contentDrafts:drafts});
 await assert.rejects(f.library.saveContentDraft(actor,create('draft-101','over count','draft-101')),/content-draft-budget-exceeded/);
 const receipt=Object.values(current.contentDraftReceipts)[0],receipts={};for(let i=0;i<1000;i++)receipts[`op-${i}`]={...receipt,operationId:`op-${i}`};
 await table.put(f.library.key(actor),{...current,contentDraftReceipts:receipts});
 await assert.rejects(f.library.saveContentDraft(actor,{...create(first.id,first.content,'op-1001'),expectedRevision:first.revision}),/content-draft-budget-exceeded/);
 assert.deepEqual(await f.library.readContentDraft(actor,first.id),first);
 const oversizedReceipts={};for(let i=0;i<1000;i++){const operationId=`${String(i).padStart(4,'0')}-${'o'.repeat(250)}`;oversizedReceipts[operationId]={...receipt,operationId,draftId:'d'.repeat(256)};}
 assert.ok(Buffer.byteLength(JSON.stringify({contentDrafts:drafts,contentDraftReceipts:oversizedReceipts}),'utf8')>2*1024*1024);
 assert.equal(libraryStateSchema.safeParse({...current,contentDrafts:drafts,contentDraftReceipts:oversizedReceipts}).success,false);
});
