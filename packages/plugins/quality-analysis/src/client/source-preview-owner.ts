import type {LibraryOriginalPreviewInput} from 'workdsh-contracts/library';
/** Owns one detached-capable target. Late Office mounts are always disposed. */
export function mountQualitySourcePreview(target:HTMLElement,input:Omit<LibraryOriginalPreviewInput,'bytes'>,read:(signal:AbortSignal)=>Promise<Uint8Array>,mount:(target:HTMLElement,input:LibraryOriginalPreviewInput)=>Promise<()=>void>,state:(status:'ready'|'error')=>void){
 const request=new AbortController();
 let active=true,cleanup:(()=>void)|undefined;
 void (async()=>{
  try{
   const bytes=await read(request.signal);if(!active)return;
   const dispose=await mount(target,{...input,bytes});
   if(!active){dispose();return;}cleanup=dispose;state('ready');
  }catch{if(active)state('error');}
 })();
 return ()=>{if(!active)return;active=false;request.abort();const dispose=cleanup;cleanup=undefined;try{dispose?.();}finally{target.remove();}};
}
