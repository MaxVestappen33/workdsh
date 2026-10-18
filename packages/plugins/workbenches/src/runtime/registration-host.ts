import { bootstrapInstalledWorkbenchArchives } from './bootstrap-installed-archives.js';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot';
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { assertActorContext, type IdentityService } from 'workdsh-contracts';
import { handleWorkbenchRegistrationRequest, workbenchRegistrationPath } from './registration-rpc.js';
import type { WorkbenchDescriptor } from 'workdsh-contracts';
import { WorkbenchInstallationArchives } from './installation-archives.js';
import { InstalledWorkbenchManifestReader } from './installed-manifest-reader.js';
import { createWorkbenchInstallationVerifier } from './installation-verifier.js';
import { HostWorkbenchRegistration } from './host-registration.js';
import type { WorkbenchLoader } from './loader-source.js';

/** Internal platform composition. The actual official launcher supplies the
 * Profile directory; configuration and RPC cannot select another installation. */
export async function mountWorkbenchRegistrationHost<Page>(ctx:Context, isCompatible:(descriptor:WorkbenchDescriptor)=>boolean) {
  const profile=ctx.get('profileContext') as ProfileContext | undefined;
  const storage=ctx.get('storageDomain') as DomainFacility | undefined;
  const loader=ctx.get('loader') as WorkbenchLoader | undefined;
  if(!profile || !storage || !loader || !isAbsolute(profile.dir))throw new Error('workbench/host-services-unavailable');
  ctx.fiber.assertActive();
  const directory=await realpath(profile.dir);
  const installationId=createHash('sha256').update(JSON.stringify([profile.name,directory])).digest('hex');
  const archives=await WorkbenchInstallationArchives.open(storage,installationId,directory);
  try {
    ctx.fiber.assertActive();
    await bootstrapInstalledWorkbenchArchives(directory,archives,()=>ctx.fiber.assertActive());
    const verifier=createWorkbenchInstallationVerifier(directory,async(name,version)=>archives.resolve(name,version),isCompatible);
    const registration=new HostWorkbenchRegistration<Page>(loader,new InstalledWorkbenchManifestReader(directory),verifier);
    ctx.effect(()=>()=>{registration.close();return archives.close();},'workdsh.workbench.registration.close');
    const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
    const connection = ctx.get('connection') as HostConnectionHandle | undefined;
    if (identity && connection) ctx.effect(() => connection.fetch.register({ path: workbenchRegistrationPath, methods: ['POST'], requestBody: 'streaming',
      fetch: request => handleWorkbenchRegistrationRequest(request, registration, async signal => {
        const actor = await identity.resolve(undefined, signal); assertActorContext(actor);
        return () => {
          signal.throwIfAborted(); ctx.fiber.assertActive();
          const profile = identity.profile();
          if (profile.principalId !== actor.principalId || profile.organization.id !== actor.organizationId || profile.resolvedBy !== actor.resolvedBy ||
              identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('workbench/development-access-denied');
        };
      }) }), 'workdsh.workbench.registration.rpc');
    ctx.provide('workdshWorkbenchInstallationArchives',archives);
    ctx.provide('workdshWorkbenchRegistration',registration);
    return Object.freeze({registration,archives,installationId,directory});
  } catch(cause) {await archives.close();throw cause;}
}
