import {checkpointWorkbenchSource} from './source-checkpoint.js';
import type {WorkbenchRequirementsService} from './requirements-service.js';
import { mkdir, realpath, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { getDshRuntimeVersion, type ProfileContext } from '@deepseek-ai/dsh-app-boot';
import type { IdentityService } from 'workdsh-contracts';
import type { VerifyWorkbenchDevelopmentSource } from './development-service.js';
import { prepareWorkbenchDevelopmentSource } from './prepare-development-source.js';

/** Profile-local source ownership. A buildable entry scaffold is prepared for new directories;
 * the Agent must implement and validate executable plugin entries. */
export function createProfileWorkbenchDevelopmentSourceVerifier(ctx: Context): VerifyWorkbenchDevelopmentSource {
  const profile = ctx.get('profileContext') as ProfileContext | undefined;
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  if (!profile || !identity) throw new Error('workbench/host-services-unavailable');
  const captured = { name: profile.name, dir: profile.dir, home: profile.home };
  return async (actor, development, signal) => {
    const authorize = () => {
      signal?.throwIfAborted(); ctx.fiber.assertActive();
      const current = ctx.get('profileContext') as ProfileContext | undefined;
      const member = identity.profile();
      if (!current || current.name !== captured.name || current.dir !== captured.dir || current.home !== captured.home)
        throw new Error('workbench/installation-target-changed');
      if (member.principalId !== actor.principalId || member.organization.id !== actor.organizationId ||
          member.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active' ||
          development.owner.ownerPrincipalId !== actor.principalId || development.owner.organizationId !== actor.organizationId)
        throw new Error('workbench/development-access-denied');
    };
    authorize();
    const profileDirectory = await realpath(captured.dir);
    const sdkManifest=JSON.parse(await readFile(join(profileDirectory,'node_modules/workdsh-plugin-workbenches/package.json'),'utf8')) as {name?:string;version?:string};
    authorize();
    if(sdkManifest.name!=='workdsh-plugin-workbenches'||typeof sdkManifest.version!=='string')throw Error('workbench/sdk-package-unavailable');
    const root = join(profileDirectory, 'workdsh-workbench-sources');
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (await realpath(root) !== root) throw new Error('workbench/source-directory-outside');
    const requirements=ctx.get('workdshWorkbenchRequirements') as Pick<WorkbenchRequirementsService,'history'>|undefined;
    if(!requirements)throw new Error('workbench/host-services-unavailable');
    const saved=(await requirements.history(development.id,signal)).find(item=>item.id===development.requirementsRevision);
    authorize();
    if(!saved||saved.owner.ownerPrincipalId!==actor.principalId||saved.owner.organizationId!==actor.organizationId)throw new Error('workbench/requirements-revision-conflict');
    const prepared = await prepareWorkbenchDevelopmentSource(root, development, {
      id: development.workbenchId, title: saved.requirements.title, description: '',
      protocolVersion: '1.0', layout: 'full-page',
      hostCompatibility: { sdk: '^1.0.0', harness: getDshRuntimeVersion() }, capabilities: [],
    }, authorize, signal, saved.requirements.system,sdkManifest.version);
    // Never redirect an existing development Session to a different directory.
    if (development.source && (development.source.hostId !== development.target.hostId ||
        development.source.directory !== prepared.directory)) throw new Error('workbench/source-identity-mismatch');
    authorize();
    const checkpoint=await checkpointWorkbenchSource(prepared.directory,join(profileDirectory,'workdsh-workbench-source-checkpoints',basename(prepared.directory)),authorize,signal);
    authorize();
    return Object.freeze({ hostId: development.target.hostId, directory: prepared.directory,
      revision: `source-sha256:${checkpoint.sha256}` });
  };
}
