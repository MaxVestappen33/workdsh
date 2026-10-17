/** One sandboxed Office iframe; no credentials or arbitrary backend URLs. */
export function createOfficeOriginalSaveChannel(source:()=>unknown,save:(bytes:Uint8Array,signal:AbortSignal)=>Promise<void>,reply:(value:{type:'workdsh-office-save-result';requestId:string;ok:boolean})=>void){
 let active=true,pending=false;const request=new AbortController();
 return {
  async handle(sender:unknown,data:unknown){
   if(!active||pending||!source()||sender!==source()||!data||typeof data!=='object')return false;
   const message=data as Record<string,unknown>;
   if(Object.keys(message).some(key=>!['type','requestId','bytes'].includes(key))||message.type!=='workdsh-office-save'||typeof message.requestId!=='string'||!/^save-[1-9][0-9]{0,8}$/.test(message.requestId)||!(message.bytes instanceof Uint8Array)||!message.bytes.byteLength||message.bytes.byteLength>10*1024*1024)return false;
   pending=true;const requestId=message.requestId,bytes=Uint8Array.from(message.bytes);
   try{await save(bytes,request.signal);if(active&&!request.signal.aborted)reply({type:'workdsh-office-save-result',requestId,ok:true});}
   catch{if(active&&!request.signal.aborted)reply({type:'workdsh-office-save-result',requestId,ok:false});}
   finally{pending=false;}
   return true;
  },
  dispose(){active=false;request.abort();},
 };
}
