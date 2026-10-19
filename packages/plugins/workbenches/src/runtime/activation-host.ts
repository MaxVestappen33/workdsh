import { createWorkbenchActivationAccess } from './activation-access.js';
import type { Context } from '@deepseek-ai/cordis';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import type { ActorContext, IdentityService, WorkbenchDescriptor } from 'workdsh-contracts';
import { assertActorContext } from 'workdsh-contracts';
import { setWorkbenchBundleEnabled, type WorkbenchBundleManager } from './activation-owner.js';
import { readWorkbenchRequestBody } from './request-body.js';
import type { WorkbenchDevelopmentService } from './development-service.js';
import type { WorkbenchInstallationArchives } from './installation-archives.js';
import { createProfileWorkbenchTarget } from './profile-target.js';
import { confirmWorkbenchRuntimeSelection } from './activation-observation.js';
import type { HostWorkbenchRegistration } from './host-registration.js';
export async function mountWorkbenchActivationHost(ctx: Context, directory: string, archives: WorkbenchInstallationArchives, development: WorkbenchDevelopmentService, isCompatible: (descriptor: WorkbenchDescriptor) => boolean,
  verifyOfflineAssociation?: (actor:ActorContext,id:string,expected:{packageName:string;workbenchId:string},signal?:AbortSignal)=>Promise<boolean>) {
  const connection = ctx.get('connection') as HostConnectionHandle | undefined;
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  if (!connection || !identity) throw new Error('workbench/host-services-unavailable');
  const resolveTarget = await createProfileWorkbenchTarget(ctx);
  ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-activation', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        const value = await readWorkbenchRequestBody(request) as Record<string, unknown>;
        const fields = ['developmentId', 'packageName', 'version', 'workbenchId', 'sha256', 'enabled'];
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)) ||
            !fields.slice(1, 5).every(key => typeof value[key] === 'string' && value[key].trim() && (value[key] as string).length <= 214) ||
            (value.developmentId !== undefined && (typeof value.developmentId !== 'string' || !value.developmentId.trim())) || typeof value.enabled !== 'boolean' || !/^[a-f0-9]{64}$/.test(value.sha256 as string))
          return Response.json({ ok: false, error: { code: 'workbench/invalid-request' } }, { status: 400 });
        const actor = await identity.resolve(undefined, request.signal); assertActorContext(actor);
        const access = createWorkbenchActivationAccess(identity, actor, () => ctx.fiber.assertActive(), request.signal);
        access.checkIdentity(); await resolveTarget(actor, request.signal);
        if (!access.profileManager) {
          const entries = await development.list(request.signal); access.checkIdentity();
          const offline = typeof value.developmentId === 'string' && value.developmentId.startsWith('import:') && await verifyOfflineAssociation?.(actor,value.developmentId,{packageName:value.packageName as string,workbenchId:value.workbenchId as string},request.signal);
          access.checkIdentity();
          if (!offline && !entries.some(row => row.development.id === value.developmentId && row.development.packageName === value.packageName && row.development.workbenchId === value.workbenchId))
            throw new Error('workbench/development-owner-mismatch');
          access.confirmDevelopmentAssociation();
        }
        const manager = ctx.get('pluginManager') as WorkbenchBundleManager | undefined;
        if (!manager) return Response.json({ ok: false, error: { code: 'workbench/activation-unavailable' } }, { status: 503 });
        const result = await setWorkbenchBundleEnabled({ installationRoot: directory, archives, manager, authorize: access.authorize, isCompatible,
          enabled: value.enabled, expected: { packageName: value.packageName as string, version: value.version as string,
            workbenchId: value.workbenchId as string, sha256: value.sha256 as string } }, request.signal);
        await resolveTarget(actor, request.signal); access.authorize();
        const registration = ctx.get('workdshWorkbenchRegistration') as HostWorkbenchRegistration<string> | undefined;
        if (!registration) throw new Error('workbench/host-services-unavailable');
        const observed = confirmWorkbenchRuntimeSelection(result, value.enabled, value.sha256 as string, registration.list());
        return Response.json({ ok: true, value: observed });
      } catch (cause) {
        const code = cause instanceof Error && /^workbench\/[a-z-]+$/.test(cause.message) ? cause.message : 'workbench/activation-unconfirmed';
        return Response.json({ ok: false, error: { code } }, { status: request.signal.aborted ? 408 : ['workbench/development-access-denied', 'workbench/development-owner-mismatch'].includes(code) ? 403 : 409 });
      }
    } }), 'workdsh.workbench.activation.rpc');
}
