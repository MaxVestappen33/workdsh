export interface WorkbenchOfflineImport {readonly importId:string;readonly packageName:string;readonly workbenchId:string;readonly createdAt:string}
/** Member-owned Host references; no browser persistence or caller-selected identity. */
export function createWorkbenchOfflineImportsClient(transport:typeof fetch=fetch) {
  return async(signal?:AbortSignal):Promise<readonly WorkbenchOfflineImport[]>=>{
    const lifetime=AbortSignal.any([AbortSignal.timeout(30_000),...(signal?[signal]:[])]);lifetime.throwIfAborted();
    const response=await transport('/api/workdsh-workbench-offline-imports',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}',signal:lifetime});
    const envelope=await response.json();lifetime.throwIfAborted();
    if(!response.ok||envelope?.ok!==true||!Array.isArray(envelope.value))throw new Error('workbench/records-unavailable');
    const ids=new Set<string>();
    return Object.freeze(envelope.value.map((row:WorkbenchOfflineImport)=>{
      if(!row||typeof row.importId!=='string'||!/^import:[a-f0-9-]{36}$/.test(row.importId)||ids.has(row.importId)||
        typeof row.packageName!=='string'||row.packageName.length>214||!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(row.packageName)||
        typeof row.workbenchId!=='string'||!row.workbenchId||row.workbenchId.length>128||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw new Error('workbench/invalid-response');
      ids.add(row.importId);return Object.freeze({importId:row.importId,packageName:row.packageName,workbenchId:row.workbenchId,createdAt:row.createdAt});
    }));
  };
}
