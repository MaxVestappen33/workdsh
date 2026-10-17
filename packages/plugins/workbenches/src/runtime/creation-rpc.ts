import type {WorkbenchCreationService} from './creation-service.js';
import {readWorkbenchRequestBody} from './request-body.js';

export async function handleWorkbenchCreationRequest(request:Request,service:Pick<WorkbenchCreationService,'list'|'open'|'confirm'>){
  try{
    if(request.method!=='POST')return Response.json({ok:false,error:{code:'workbench/invalid-method'}},{status:405});
    const body=await readWorkbenchRequestBody(request) as {endpoint?:unknown;payload?:Record<string,unknown>};
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['endpoint','payload'].includes(key))||!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload))throw Error('workbench/invalid-creation-request');
    const p=body.payload,keys=Object.keys(p);let value;
    if(body.endpoint==='list'&&keys.length===0)value=await service.list(request.signal);
    else if(body.endpoint==='open'&&keys.length===2&&typeof p.id==='string'&&typeof p.idea==='string')value=await service.open(p.id,p.idea,request.signal);
    else if(body.endpoint==='confirm'&&keys.length===3&&typeof p.id==='string'&&typeof p.expectedRevision==='string'&&keys.includes('requirements'))value=await service.confirm(p.id,p.expectedRevision,p.requirements,request.signal);
    else throw Error('workbench/invalid-creation-request');
    return Response.json({ok:true,value});
  }catch(cause){
    const message=cause instanceof Error?cause.message:'';
    const code=/^workbench\/[a-z0-9-]+$/.test(message)?message:'workbench/creation-failed';
    const status=request.signal.aborted?408:code==='workbench/creation-access-denied'?403:code==='workbench/creation-not-found'?404:code==='workbench/creation-conflict'?409:code.includes('invalid-')?400:503;
    return Response.json({ok:false,error:{code,message:status===409?'内容已变化，请重新读取后继续。':'本次操作未完成，请保留当前内容重试。'}},{status});
  }
}
