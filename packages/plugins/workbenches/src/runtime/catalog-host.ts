import type { Context } from '@deepseek-ai/cordis';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { assertActorContext, type IdentityService, type WorkbenchDescriptor } from 'workdsh-contracts';
import { readInstalledWorkbenchCatalog, type WorkbenchCatalogManager } from './catalog-owner.js';
import type { WorkbenchInstallationArchives } from './installation-archives.js';
import type { HostWorkbenchRegistration } from './host-registration.js';
import { createProfileWorkbenchTarget } from './profile-target.js';
import { readWorkbenchRequestBody } from './request-body.js';
export async function mountWorkbenchCatalogHost(ctx: Context, directory: string, archives: WorkbenchInstallationArchives,
  registration: HostWorkbenchRegistration<unknown>, isCompatible: (descriptor: WorkbenchDescriptor) => boolean) {
  const identity = ctx.get('workdshIdentity') as IdentityService;
  const connection = ctx.get('connection') as HostConnectionHandle;
  const resolveTarget = await createProfileWorkbenchTarget(ctx);
  ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-catalog', methods: ['POST'], requestBody: 'streaming', fetch: async request => {
    try {
      const body = await readWorkbenchRequestBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return Response.json({ ok: false, error: { code: 'workbench/invalid-request' } }, { status: 400 });
      const actor = await identity.resolve(undefined, request.signal); assertActorContext(actor);
      const authorize = () => {
        request.signal.throwIfAborted(); ctx.fiber.assertActive(); const current = identity.profile();
        if (current.principalId !== actor.principalId || current.organization.id !== actor.organizationId || current.resolvedBy !== actor.resolvedBy ||
            identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('workbench/development-access-denied');
      };
      authorize(); await resolveTarget(actor, request.signal);
      const manager = ctx.get('pluginManager') as WorkbenchCatalogManager | undefined;
      if (!manager) return Response.json({ ok: false, error: { code: 'workbench/catalog-unavailable' } }, { status: 503 });
      const records = await readInstalledWorkbenchCatalog({ installationRoot: directory, archives, manager, authorize, isCompatible,
        registered: (name, version, hash) => registration.list().some(row => row.package.packageName === name && row.package.version === version && row.package.sha256 === hash) }, request.signal);
      await resolveTarget(actor, request.signal); authorize();
      const owners = { 'skill.select': 'workdshSkills', 'expert.select': 'workdshExperts', 'connector.invoke': 'workdshConnectors' } as const;
      const value = records.map(row => ({ ...row, missingResourceCatalogs: (row as { descriptor?: WorkbenchDescriptor }).descriptor?.capabilities.filter(capability => {
        if (!(capability in owners)) return false;
        const owner = ctx.get(owners[capability as keyof typeof owners]) as { list?: unknown } | undefined;
        return !owner || typeof owner.list !== 'function';
      }) ?? [] }));
      authorize();
      return Response.json({ ok: true, value });
    } catch { return Response.json({ ok: false, error: { code: 'workbench/catalog-unavailable' } }, { status: request.signal.aborted ? 408 : 403 }); }
  } }), 'workdsh.workbench.catalog.rpc');
}
