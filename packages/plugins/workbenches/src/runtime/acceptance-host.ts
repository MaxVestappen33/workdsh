import type{Context}from'@deepseek-ai/cordis';
import type{DomainFacility}from'@deepseek-ai/dsh-storage-domain';
import type{HostConnectionHandle}from'@deepseek-ai/dsh-client-connection';
import type{IdentityService,WorkbenchDescriptor}from'workdsh-contracts';
import type{WorkbenchDevelopmentService}from'./development-service.js';
import type{WorkbenchRequirementsService}from'./requirements-service.js';
import type{WorkbenchInstallationArchives}from'./installation-archives.js';
import type{HostWorkbenchRegistration}from'./host-registration.js';
import{readInstalledWorkbenchCatalog,type WorkbenchCatalogManager}from'./catalog-owner.js';
import{createProfileWorkbenchTarget}from'./profile-target.js';
import{readWorkbenchRequestBody}from'./request-body.js';
import{WorkbenchAcceptanceService,type AcceptanceBinding}from'./acceptance-service.js';
export async function mountWorkbenchAcceptanceHost(ctx:Context,development:WorkbenchDevelopmentService,requirements:WorkbenchRequirementsService,directory:string,archives:WorkbenchInstallationArchives,registration:HostWorkbenchRegistration<unknown>,compatible:(d:WorkbenchDescriptor)=>boolean){
 const identity=ctx.get('workdshIdentity') as IdentityService,storage=ctx.get('storageDomain') as DomainFacility,connection=ctx.get('connection') as HostConnectionHandle;
 const target=await createProfileWorkbenchTarget(ctx);
 const service=new WorkbenchAcceptanceService(storage,identity,async(id,actor,signal)=>{
  const check=()=>{signal?.throwIfAborted();ctx.fiber.assertActive();const p=identity.profile();if(p.principalId!==actor.principalId||p.organization.id!==actor.organizationId||p.resolvedBy!==actor.resolvedBy||identity.membership(actor.organizationId,actor.principalId)?.state!=='active')throw Error('workbench/development-access-denied');};
  check();const entries=await development.list(signal);check();const d=entries.find(row=>row.development.id===id)?.development;if(!d)throw Error('workbench/development-not-found');
  const currentTarget=await target(actor,signal);check();if(currentTarget.hostId!==d.target.hostId||currentTarget.profileId!==d.target.profileId||currentTarget.installationId!==d.target.installationId)throw Error('workbench/installation-target-changed');
  const latest=(await requirements.history(id,signal)).at(-1);check();if(latest?.id!==d.requirementsRevision)throw Error('workbench/requirements-revision-conflict');
  const manager=ctx.get('pluginManager') as WorkbenchCatalogManager|undefined;if(!manager)throw Error('workbench/catalog-unavailable');
  const rows=await readInstalledWorkbenchCatalog({installationRoot:directory,archives,manager,authorize:check,isCompatible:compatible,registered:(name,version,hash)=>registration.list().some(r=>r.package.packageName===name&&r.package.version===version&&r.package.sha256===hash)},signal);check();
  const row=rows.find(r=>r.packageName===d.packageName),installed=row?.installed;
  const binding=installed?{developmentId:id,requirementsRevision:d.requirementsRevision,packageName:d.packageName,version:installed.version,sha256:installed.sha256,hostId:d.target.hostId,profileId:d.target.profileId,installationId:d.target.installationId}:undefined;
  return {binding,criteria:latest.requirements.acceptance,ready:!!(installed&&row?.registered&&row.selected&&row.compatible&&!row.errorCode&&row.runtimeStatus==='active')};
 });
 ctx.effect(()=>()=>service.close(),'workdsh.acceptance.close');
 ctx.effect(()=>connection.fetch.register({path:'/api/workdsh-workbench-acceptance',methods:['POST'],requestBody:'streaming',fetch:async request=>{try{
  const body=await readWorkbenchRequestBody(request) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['developmentId','accept'].includes(k))||typeof body.developmentId!=='string'||('accept'in body&&(!body.accept||typeof body.accept!=='object')))throw Error('workbench/invalid-request');
  const value=await service.invoke(body.developmentId,body.accept as AcceptanceBinding|undefined,request.signal);ctx.fiber.assertActive();return Response.json({ok:true,value});
 }catch(error){const code=error instanceof Error&&/^workbench\/[a-z-]+$/.test(error.message)?error.message:'workbench/acceptance-unavailable';return Response.json({ok:false,error:{code}},{status:code==='workbench/invalid-request'?400:409});}}}),'workdsh.acceptance.rpc');
}
