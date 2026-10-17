import type { Context } from '@deepseek-ai/cordis';
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import type { IdentityService } from 'workdsh-contracts';
import { WorkbenchRequirementsService } from './requirements-service.js';
import { handleWorkbenchRequirementsRequest, workbenchRequirementsPath } from './requirements-rpc.js';

/** Internal mount, composed only after the platform's kernel and installation gates pass. */
export function mountWorkbenchRequirementsHost(ctx: Context): WorkbenchRequirementsService {
  const storage = ctx.get('storageDomain') as DomainFacility | undefined;
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  const connection = ctx.get('connection') as HostConnectionHandle | undefined;
  if (!storage || !identity || !connection) throw new Error('workbench/host-services-unavailable');
  const service = new WorkbenchRequirementsService(storage, identity);
  ctx.effect(() => () => service.close(), 'workdsh.workbench.requirements.close');
  ctx.effect(() => connection.fetch.register({ path: workbenchRequirementsPath, methods: ['POST'], requestBody: 'streaming', fetch: request => handleWorkbenchRequirementsRequest(request, service) }), 'workdsh.workbench.requirements.rpc');
  ctx.provide('workdshWorkbenchRequirements', service);
  return service;
}
