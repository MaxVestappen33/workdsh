import type {IConversation} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {ISessions,SessionReference} from '@deepseek-ai/dsh-api-session-controller/client';
type NativeWorkbenchConversationContext={readonly sessions:Pick<ISessions,'retain'>;readonly conversation:Pick<IConversation,'input'|'blocks'>};
export interface QualityNativeDraftGuard{readonly signal:AbortSignal;allowInitialization(prompt:string):void;}

/** Inspect the official input owner before changing a business target. This
 * temporary reference neither mounts another composer nor modifies its text. */
export async function qualityNativeDraftState(native:NativeWorkbenchConversationContext,sessionId:string,signal:AbortSignal,operation?:(guard:QualityNativeDraftGuard)=>Promise<void>):Promise<'empty'|'draft'|'busy'>{
 signal.throwIfAborted();
 const reference=native.sessions.retain(sessionId as SessionReference['sessionId'],{source:'workdshWorkbenchConversation',signal});
 try{
  const binding=await reference.ready;signal.throwIfAborted();
  if(String(binding.sessionId)!==sessionId)throw Error('quality/native-session-mismatch');
  const state=native.conversation.input.for(binding.ctx).state;
  const blocks=native.conversation.blocks,blockStore=blocks.storeFor(binding.sessionId);
  // Native model routing may briefly block a newly retained session. Wait for
  // its owner to settle; never clear another owner's block or change input.
  if(blockStore.getSnapshot()!==undefined&&!binding.session.getSnapshot().running&&state.getSnapshot().phase==='plain'){
   await new Promise<void>((resolve,reject)=>{
    let unsubscribe=()=>{},timer:ReturnType<typeof setTimeout>;
    const finish=(error?:unknown)=>{clearTimeout(timer);unsubscribe();signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish(signal.reason);
    timer=setTimeout(()=>finish(),1500);
    unsubscribe=blockStore.subscribe(()=>{if(blockStore.getSnapshot()===undefined)finish();});
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();else if(blockStore.getSnapshot()===undefined)finish();
   });
  }
  signal.throwIfAborted();const input=state.getSnapshot();
  if(binding.session.getSnapshot().running||input.phase!=='plain')return 'busy';
  if(input.draft.trim()||input.attachmentIds.length||input.occurrences.length)return 'draft';
  if(!operation)return 'empty';
  // Another owner (for example model selection) already made this Composer
  // inert. Its block must not be replaced or cleared by a business handoff.
  if(blockStore.getSnapshot()!==undefined)return 'busy';
  // Public Composer blocking is a UI affordance, not a cross-process lock.
  // Cancellation cannot roll back a Host storage commit that already happened.
  const ownedBlock={reason:'正在准备分析请求，请稍候…'},cancel=new AbortController(),operationSignal=AbortSignal.any([signal,cancel.signal]);
  let revision=input.draftRev,draft=input.draft,expectedPrompt:string|undefined,initialized=false;
  const changed=()=>cancel.abort(Error('quality/native-input-changed'));
  const check=()=>{
   if(blockStore.getSnapshot()!==ownedBlock){changed();return;}
   const current=state.getSnapshot();
   if(binding.session.getSnapshot().running||current.phase!=='plain'||current.attachmentIds.length||current.occurrences.length){changed();return;}
   if(current.draftRev===revision&&current.draft===draft)return;
   // The SDK initialization is the only admitted write. The plugin never
   // calls setDraft or consumes a user's text, attachments or references.
   if(!initialized&&expectedPrompt!==undefined&&current.draft===expectedPrompt){initialized=true;revision=current.draftRev;draft=current.draft;return;}
   changed();
  };
  let unwatchInput=()=>{},unwatchSession=()=>{},unwatchBlock=()=>{};
  try{
   unwatchInput=state.subscribe(check);unwatchSession=binding.session.subscribe(check);
   blocks.set(binding.sessionId,ownedBlock);
   unwatchBlock=blockStore.subscribe(()=>{if(blockStore.getSnapshot()!==ownedBlock)changed();});
   check();operationSignal.throwIfAborted();
   await operation({signal:operationSignal,allowInitialization(prompt){check();operationSignal.throwIfAborted();expectedPrompt=prompt;}});
   check();operationSignal.throwIfAborted();return 'empty';
  }catch(error){if(cancel.signal.aborted&&!signal.aborted)throw cancel.signal.reason;throw error;}
  finally{
   unwatchInput();unwatchSession();unwatchBlock();
   if(blockStore.getSnapshot()===ownedBlock)blocks.set(binding.sessionId,undefined);
  }
 }finally{reference.release();}
}
