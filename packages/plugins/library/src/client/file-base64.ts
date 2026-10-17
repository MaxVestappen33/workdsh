/** Stop browser file encoding when its owning request or plugin is closed. */
export function fileBase64(file:File,signal?:AbortSignal):Promise<string>{
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const reader=new FileReader();let settled=false;
  const finish=(error:unknown,value?:string)=>{
   if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);
   reader.onload=null;reader.onerror=null;reader.onabort=null;
   if(error!==undefined)reject(error);else resolve(value!);
  };
  const cancel=()=>{finish(signal?.reason??new DOMException('已取消','AbortError'));if(reader.readyState===FileReader.LOADING)reader.abort();};
  reader.onerror=()=>finish(reader.error??new Error('读取文件失败。'));
  reader.onabort=()=>finish(new DOMException('已取消','AbortError'));
  reader.onload=()=>{
   const result=reader.result;
   if(typeof result!=='string'||!/^data:[^,]*;base64,/.test(result)){finish(new Error('文件编码无效'));return;}
   finish(undefined,result.slice(result.indexOf(',')+1));
  };
  signal?.addEventListener('abort',cancel,{once:true});
  try{reader.readAsDataURL(file);}catch(error){finish(error);}
 });
}
