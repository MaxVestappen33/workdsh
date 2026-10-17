import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/native-draft-state.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {qualityNativeDraftState}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
function fixture({draft='',attachmentIds=[],occurrences=[],phase='plain',running=false,readyError,initialBlock}={}){
 let released=0,retained=0,block=initialBlock;const input={draft,attachmentIds,occurrences,phase,draftRev:0},inputListeners=new Set(),blockListeners=new Set();
 const subscribe=listeners=>listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
 const binding={sessionId:'native-owned',ctx:{},session:{getSnapshot:()=>({running}),subscribe:()=>()=>{}}};
 const setBlock=value=>{block=value;for(const listener of blockListeners)listener();};
 const blocks={storeFor:()=>({getSnapshot:()=>block,subscribe:subscribe(blockListeners)}),set:(_id,value)=>setBlock(value)};
 const native={sessions:{retain(id,options){assert.equal(id,'native-owned');assert.equal(options.source,'workdshWorkbenchConversation');retained++;return{ready:readyError?Promise.reject(readyError):Promise.resolve(binding),release(){released++;}};}},conversation:{blocks,input:{for(ctx){assert.equal(ctx,binding.ctx);return{state:{getSnapshot:()=>input,subscribe:subscribe(inputListeners)}};}}}};
 return{native,input,counts:()=>({released,retained}),block:()=>block,setBlock,publish(patch){Object.assign(input,patch);for(const listener of inputListeners)listener();},listeners:()=>inputListeners.size+blockListeners.size};
}
test('preflight reads native text and references without replacing or submitting them',async()=>{
 for(const args of [{draft:'尚未发送的用户输入'},{attachmentIds:['file']},{occurrences:['reference']}]){
  const f=fixture(args),before=structuredClone(f.input);
  assert.equal(await qualityNativeDraftState(f.native,'native-owned',new AbortController().signal),'draft');
  assert.deepEqual(f.input,before);assert.deepEqual(f.counts(),{retained:1,released:1});
 }
});
test('a running native Agent or submission is busy even when input text is empty',async()=>{
 for(const args of [{running:true},{phase:'submitting'}]){
  const f=fixture(args);assert.equal(await qualityNativeDraftState(f.native,'native-owned',new AbortController().signal),'busy');assert.equal(f.counts().released,1);
 }
 const f=fixture();assert.equal(await qualityNativeDraftState(f.native,'native-owned',new AbortController().signal),'empty');
});
test('cancelled preflight never retains a Session and failed opening releases the temporary reference',async()=>{
 const signal=AbortSignal.abort(),f=fixture();await assert.rejects(qualityNativeDraftState(f.native,'native-owned',signal),{name:'AbortError'});assert.equal(f.counts().retained,0);
 const failed=fixture({readyError:Error('native-open-failed')});await assert.rejects(qualityNativeDraftState(failed.native,'native-owned',new AbortController().signal),/native-open-failed/);assert.equal(failed.counts().released,1);
});
test('guard holds the native reference and only its temporary public block until handoff finishes',async()=>{
 const f=fixture(),held=Promise.withResolvers(),started=Promise.withResolvers();
 const pending=qualityNativeDraftState(f.native,'native-owned',new AbortController().signal,async guard=>{assert.equal(guard.signal.aborted,false);assert.deepEqual(f.counts(),{retained:1,released:0});assert.equal(f.block().reason,'正在准备分析请求，请稍候…');started.resolve();await held.promise;});
 await started.promise;held.resolve();assert.equal(await pending,'empty');assert.equal(f.block(),undefined);assert.equal(f.counts().released,1);assert.equal(f.listeners(),0);
});
test('an existing Composer block is preserved and no target operation is invoked',async()=>{
 const block={reason:'模型不可用'},f=fixture({initialBlock:block});let called=false;
 assert.equal(await qualityNativeDraftState(f.native,'native-owned',new AbortController().signal,async()=>{called=true;}),'busy');assert.equal(called,false);assert.equal(f.block(),block);assert.equal(f.counts().released,1);
});
const untilAbort=signal=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
test('editor revisions, submission, attachments and references cancel the protected RPC without consuming input',async()=>{
 for(const patch of [{draftRev:1},{draft:'新的用户输入',draftRev:1},{phase:'submitting'},{attachmentIds:['file']},{occurrences:['reference']}] ){
  const f=fixture(),started=Promise.withResolvers();let operationSignal;
  const pending=qualityNativeDraftState(f.native,'native-owned',new AbortController().signal,async guard=>{operationSignal=guard.signal;started.resolve();await untilAbort(guard.signal);});
  await started.promise;f.publish(patch);await assert.rejects(pending,/quality\/native-input-changed/);assert.equal(operationSignal.aborted,true);for(const [key,value]of Object.entries(patch))assert.deepEqual(f.input[key],value);assert.equal(f.block(),undefined);assert.equal(f.counts().released,1);assert.equal(f.listeners(),0);
 }
});
test('a competing owner replacing the temporary block cancels the request and keeps its own block',async()=>{
 const f=fixture(),started=Promise.withResolvers(),other={reason:'需要选择模型'};
 const pending=qualityNativeDraftState(f.native,'native-owned',new AbortController().signal,async guard=>{started.resolve();await untilAbort(guard.signal);});
 await started.promise;f.setBlock(other);await assert.rejects(pending,/quality\/native-input-changed/);assert.equal(f.block(),other);assert.equal(f.counts().released,1);assert.equal(f.listeners(),0);
});
test('caller cancellation and failed target operations release their own temporary block',async()=>{
 const controller=new AbortController(),f=fixture(),started=Promise.withResolvers();
 const pending=qualityNativeDraftState(f.native,'native-owned',controller.signal,async guard=>{started.resolve();await untilAbort(guard.signal);});
 await started.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.block(),undefined);assert.equal(f.counts().released,1);assert.equal(f.listeners(),0);
 const failed=fixture();await assert.rejects(qualityNativeDraftState(failed.native,'native-owned',new AbortController().signal,async()=>{throw Error('target-failed');}),/target-failed/);assert.equal(failed.block(),undefined);assert.equal(failed.counts().released,1);
});
test('guard permits the expected SDK initialization once, while a subsequent edit cancels',async()=>{
 const f=fixture();assert.equal(await qualityNativeDraftState(f.native,'native-owned',new AbortController().signal,async guard=>{guard.allowInitialization('简短业务请求');f.publish({draft:'简短业务请求',draftRev:1});assert.equal(guard.signal.aborted,false);}),'empty');assert.equal(f.input.draft,'简短业务请求');
 const changed=fixture();await assert.rejects(qualityNativeDraftState(changed.native,'native-owned',new AbortController().signal,async guard=>{guard.allowInitialization('简短业务请求');changed.publish({draft:'简短业务请求',draftRev:1});changed.publish({draft:'用户随后修改',draftRev:2});guard.signal.throwIfAborted();}),/quality\/native-input-changed/);assert.equal(changed.input.draft,'用户随后修改');assert.equal(changed.block(),undefined);
});

test('native opening block can settle without false busy or clearing its owner',async()=>{
 const f=fixture({initialBlock:{reason:'准备模型'}});let called=false;
 const pending=qualityNativeDraftState(f.native,'native-owned',new AbortController().signal,async()=>{called=true;});
 await Promise.resolve();await Promise.resolve();f.setBlock(undefined);
 assert.equal(await pending,'empty');assert.equal(called,true);assert.equal(f.listeners(),0);
});
test('input entered while opening settles is preserved',async()=>{
 const f=fixture({initialBlock:{reason:'准备模型'}});let called=false;
 const pending=qualityNativeDraftState(f.native,'native-owned',new AbortController().signal,async()=>{called=true;});
 await Promise.resolve();await Promise.resolve();f.publish({draft:'用户输入',draftRev:1});f.setBlock(undefined);
 assert.equal(await pending,'draft');assert.equal(called,false);assert.equal(f.input.draft,'用户输入');assert.equal(f.listeners(),0);
});
test('cancellation while waiting preserves native block and releases reference',async()=>{
 const block={reason:'准备模型'},f=fixture({initialBlock:block}),controller=new AbortController();
 const pending=qualityNativeDraftState(f.native,'native-owned',controller.signal);
 await Promise.resolve();await Promise.resolve();controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(f.block(),block);assert.equal(f.listeners(),0);assert.equal(f.counts().released,1);
});
