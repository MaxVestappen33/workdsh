import type {Context} from '@deepseek-ai/cordis';
import type {DomainFacility} from '@deepseek-ai/dsh-storage-domain';
import type {HostConnectionHandle} from '@deepseek-ai/dsh-client-connection';
import type {IdentityService} from 'workdsh-contracts';
import {readWorkbenchRequestBody} from './request-body.js';
import {WorkbenchShortcutsService} from './shortcuts-service.js';
export function mountWorkbenchShortcutsHost(ctx:Context,available:(id:string)=>boolean){
  const service=new WorkbenchShortcutsService(ctx.get('storageDomain') as DomainFacility,ctx.get('workdshIdentity') as IdentityService,available);
  ctx.effect(()=>()=>service.close(),'workdsh.shortcuts.close');
  const connection=ctx.get('connection') as HostConnectionHandle;
  ctx.effect(()=>connection.fetch.register({path:'/api/workdsh-workbench-shortcuts',methods:['POST'],requestBody:'streaming',fetch:async request=>{
    try{
      ctx.fiber.assertActive();const body=await readWorkbenchRequestBody(request) as Record<string,unknown>;
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['id','pinned'].includes(key))||((body.id===undefined)!==(body.pinned===undefined)))throw Error('workbench/invalid-shortcut');
      const value=await service.invoke(body.id as string|undefined,body.pinned as boolean|undefined,request.signal);ctx.fiber.assertActive();return Response.json({ok:true,value});
    }catch(error){const code=error instanceof Error&&['workbench/invalid-shortcut','workbench/shortcuts-limit','workbench/shortcut-unavailable'].includes(error.message)?error.message:'workbench/shortcuts-unavailable';return Response.json({ok:false,error:{code}},{status:code==='workbench/invalid-shortcut'?400:code==='workbench/shortcuts-unavailable'?403:409});}
  }}),'workdsh.shortcuts.rpc');
}
