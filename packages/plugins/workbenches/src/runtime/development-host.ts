import {prepareSourceRecovery} from './prepare-source-recovery.js';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {join} from 'node:path';
import type {ProfileContext} from '@deepseek-ai/dsh-app-boot';
import {verifySourceCheckpoint} from './verify-source-checkpoint.js';
import {listSourceCheckpoints} from './source-checkpoint-catalog.js';
import type { Context } from '@deepseek-ai/cordis';
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import type { IdentityService } from 'workdsh-contracts';
import type { WorkbenchRequirementsService } from './requirements-service.js';
import { WorkbenchDevelopmentService, type ResolveWorkbenchDevelopmentTarget, type VerifyWorkbenchDevelopmentSession, VerifyWorkbenchDevelopmentSource } from './development-service.js';
import { handleWorkbenchDevelopmentRequest, workbenchDevelopmentPath } from './development-rpc.js';

/** Internal mount; the enclosing platform plugin owns the requirements service.
 * Target metadata must come from the selected Host's actual installation adapter.
 * This function is not itself a loadable package or a Profile activation.
 */
export function mountWorkbenchDevelopmentHost(ctx: Context, resolveTarget: ResolveWorkbenchDevelopmentTarget, ownedRequirements?: Pick<WorkbenchRequirementsService, 'history'>, sessionVerifier?: VerifyWorkbenchDevelopmentSession, sourceVerifier?: VerifyWorkbenchDevelopmentSource): WorkbenchDevelopmentService {
  const storage = ctx.get('storageDomain') as DomainFacility | undefined;
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  const connection = ctx.get('connection') as HostConnectionHandle | undefined;
  // Same-fiber services are not visible through strict ctx.get until apply finishes.
  // An enclosing authoring mount passes its newly created service explicitly.
  const requirements = ownedRequirements ?? ctx.get('workdshWorkbenchRequirements') as Pick<WorkbenchRequirementsService, 'history'> | undefined;
  if (!storage || !identity || !connection || !requirements) throw new Error('workbench/host-services-unavailable');
  const profile=ctx.get('profileContext') as ProfileContext|undefined;
  const captured=profile&&{name:profile.name,dir:profile.dir,home:profile.home};
  const service = new WorkbenchDevelopmentService(storage, identity, requirements, resolveTarget, sessionVerifier, sourceVerifier,captured?async(development,check,signal)=>{
    const guard=()=>{check();ctx.fiber.assertActive();const current=ctx.get('profileContext') as ProfileContext|undefined;if(!current||current.name!==captured.name||current.dir!==captured.dir||current.home!==captured.home)throw new Error('workbench/installation-target-changed');};
    guard();const root=await realpath(captured.dir);guard();
    const key=createHash('sha256').update(JSON.stringify([development.owner.organizationId,development.owner.ownerPrincipalId,development.target.hostId,development.id])).digest('hex');
    return listSourceCheckpoints(join(root,'workdsh-workbench-source-checkpoints',key),guard,signal);
  }:undefined,captured?async(development,sha256,check,signal)=>{
    const guard=()=>{check();ctx.fiber.assertActive();const current=ctx.get('profileContext') as ProfileContext|undefined;if(!current||current.name!==captured.name||current.dir!==captured.dir||current.home!==captured.home)throw new Error('workbench/installation-target-changed');};
    guard();const root=await realpath(captured.dir);guard();
    const key=createHash('sha256').update(JSON.stringify([development.owner.organizationId,development.owner.ownerPrincipalId,development.target.hostId,development.id])).digest('hex');
    return verifySourceCheckpoint(join(root,'workdsh-workbench-source-checkpoints',key),sha256,guard,signal);
  }:undefined,captured?async(development,sha256,check,signal)=>{
    const guard=()=>{check();ctx.fiber.assertActive();const current=ctx.get('profileContext') as ProfileContext|undefined;if(!current||current.name!==captured.name||current.dir!==captured.dir||current.home!==captured.home)throw new Error('workbench/installation-target-changed');};
    guard();const root=await realpath(captured.dir);guard();
    const key=createHash('sha256').update(JSON.stringify([development.owner.organizationId,development.owner.ownerPrincipalId,development.target.hostId,development.id])).digest('hex');
    const source=join(root,'workdsh-workbench-sources',key);
    if(development.source?.directory!==source||development.source.hostId!==development.target.hostId)throw new Error('workbench/source-identity-mismatch');
    const result=await prepareSourceRecovery(source,join(root,'workdsh-workbench-source-checkpoints',key),join(root,'workdsh-workbench-source-recoveries',key),development.source.revision.slice('source-sha256:'.length),sha256,guard,signal);
    return {journalId:result.journalId,beforeSha256:result.before.sha256,targetSha256:result.candidate.sha256,state:'prepared' as const};
  }:undefined);
  ctx.effect(() => () => service.close(), 'workdsh.workbench.development.close');
  ctx.effect(() => connection.fetch.register({ path: workbenchDevelopmentPath, methods: ['POST'], requestBody: 'streaming', fetch: request => handleWorkbenchDevelopmentRequest(request, service) }), 'workdsh.workbench.development.rpc');
  ctx.provide('workdshWorkbenchDevelopment', service);
  return service;
}
