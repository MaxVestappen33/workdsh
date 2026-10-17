import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import { getDshRuntimeVersion, type ProfileContext } from '@deepseek-ai/dsh-app-boot';
import type { ResolveWorkbenchDevelopmentTarget } from './development-service.js';

/** Host target facts from the native launcher. Identity authorization remains
 * in the development service; these identifiers are not security boundaries. */
export async function createProfileWorkbenchTarget(ctx:Context):Promise<ResolveWorkbenchDevelopmentTarget> {
  const profile=ctx.get('profileContext') as ProfileContext | undefined;
  if(!profile)throw new Error('workbench/host-services-unavailable');
  ctx.fiber.assertActive();
  const captured={name:profile.name,dir:profile.dir,home:profile.home};
  const [directory,home]=await Promise.all([realpath(captured.dir),realpath(captured.home)]);
  const target=Object.freeze({
    hostId:createHash('sha256').update(home).digest('hex'),
    installationId:createHash('sha256').update(JSON.stringify([captured.name,directory])).digest('hex'),
    profileId:captured.name,harnessVersion:getDshRuntimeVersion(),
  });
  return async(_actor,signal)=>{
    signal?.throwIfAborted();ctx.fiber.assertActive();
    const current=ctx.get('profileContext') as ProfileContext | undefined;
    if(!current || current.name!==captured.name || current.dir!==captured.dir || current.home!==captured.home)throw new Error('workbench/installation-target-changed');
    const [currentDirectory,currentHome]=await Promise.all([realpath(current.dir),realpath(current.home)]);
    signal?.throwIfAborted();ctx.fiber.assertActive();
    if(currentDirectory!==directory || currentHome!==home)throw new Error('workbench/installation-target-changed');
    return target;
  };
}
