import {checkpointWorkbenchSource} from './source-checkpoint.js';
import type {WorkbenchRequirementsService} from './requirements-service.js';
import { mkdir, realpath, readFile, lstat, writeFile, rename, rm } from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import type { Context } from '@deepseek-ai/cordis';
import { getDshRuntimeVersion, type ProfileContext } from '@deepseek-ai/dsh-app-boot';
import type { IdentityService } from 'workdsh-contracts';
import type { VerifyWorkbenchDevelopmentSource } from './development-service.js';
import { prepareWorkbenchDevelopmentSource } from './prepare-development-source.js';

async function saveDevelopmentRuntime(directory:string,installationAnchor:string,authorize:()=>void){
 const target=join(directory,'.workdsh-runtime.json'),temporary=target+'.tmp-'+randomUUID();
 authorize();
 try{const entry=await lstat(target);if(!entry.isFile()||entry.isSymbolicLink())throw Error('workbench/source-directory-outside');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 authorize();
 try{
  await writeFile(temporary,JSON.stringify({schemaVersion:1,installationAnchor},null,2)+'\n',{flag:'wx',mode:0o600});
  authorize();await rename(temporary,target);authorize();
 }finally{await rm(temporary,{force:true});}
}

/** Profile-local source ownership. A buildable entry scaffold is prepared for new directories;
 * the Agent must implement and validate executable plugin entries. */
export function createProfileWorkbenchDevelopmentSourceVerifier(ctx: Context): VerifyWorkbenchDevelopmentSource {
  const profile = ctx.get('profileContext') as ProfileContext | undefined;
  const identity = ctx.get('workdshIdentity') as IdentityService | undefined;
  if (!profile || !identity) throw new Error('workbench/host-services-unavailable');
  const captured = { name: profile.name, dir: profile.dir, home: profile.home, installAnchor: profile.installAnchor };
  return async (actor, development, signal) => {
    const authorize = () => {
      signal?.throwIfAborted(); ctx.fiber.assertActive();
      const current = ctx.get('profileContext') as ProfileContext | undefined;
      const member = identity.profile();
      if (!current || current.name !== captured.name || current.dir !== captured.dir || current.home !== captured.home || current.installAnchor !== captured.installAnchor)
        throw new Error('workbench/installation-target-changed');
      if (member.principalId !== actor.principalId || member.organization.id !== actor.organizationId ||
          member.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active' ||
          development.owner.ownerPrincipalId !== actor.principalId || development.owner.organizationId !== actor.organizationId)
        throw new Error('workbench/development-access-denied');
    };
    authorize();
    const profileDirectory = await realpath(captured.dir);
    // Desktop's writable Profile deliberately has no dependency tree. Resolve
    // from the Host-owned installation graph; standalone Web Profiles may own
    // their installation themselves. Never derive a package path from dir.
    const installationAnchor=captured.installAnchor??join(profileDirectory,'package.json');
    let sdkManifest:{name?:string;version?:string};
    try {
      const manifest=createRequire(installationAnchor).resolve('workdsh-plugin-workbenches/package.json');
      sdkManifest=JSON.parse(await readFile(manifest,'utf8')) as {name?:string;version?:string};
    } catch(cause) { throw new Error('workbench/sdk-package-unavailable',{cause}); }
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
    // Platform metadata is separate from developer source and excluded from the
    // starter package's files allowlist. pnpm may rebuild node_modules freely.
    await saveDevelopmentRuntime(prepared.directory,installationAnchor,authorize);
    const checkpoint=await checkpointWorkbenchSource(prepared.directory,join(profileDirectory,'workdsh-workbench-source-checkpoints',basename(prepared.directory)),authorize,signal);
    authorize();
    return Object.freeze({ hostId: development.target.hostId, directory: prepared.directory,
      revision: `source-sha256:${checkpoint.sha256}` });
  };
}
