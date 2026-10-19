/** Rechecks never publish stale identity, even when a transport ignores abort. */
export function createQualityIdentityScopeOwner(fetcher:typeof fetch,onState:(state:{checking:boolean;scope?:string;error:boolean})=>void){
 let request:AbortController|undefined,closed=false,scope:string|undefined;
 const check=async()=>{
  if(closed)return;request?.abort();const current=new AbortController();request=current;onState({checking:true,scope,error:false});
  try{
   const response=await fetcher('/api/workdsh-workbench-development',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:'identity-scope',payload:{}}),signal:current.signal});
   const result=await response.json();
   if(closed||request!==current||current.signal.aborted)return;
   if(!response.ok||result?.ok!==true||typeof result.value?.organizationId!=='string'||!result.value.organizationId.trim()||typeof result.value?.principalId!=='string'||!result.value.principalId.trim())throw new Error('quality/identity-unconfirmed');
   scope=JSON.stringify([result.value.organizationId,result.value.principalId]);onState({checking:false,scope,error:false});
  }catch{if(!closed&&request===current&&!current.signal.aborted){scope=undefined;onState({checking:false,error:true});}}
 };
 return {check,dispose(){closed=true;request?.abort();request=undefined;}};
}
