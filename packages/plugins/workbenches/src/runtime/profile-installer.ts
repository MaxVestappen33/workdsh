import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot';

/** Official package operation resolved from the launcher's published runtime.
 * Does not activate bundles or report a page running; the import owner must
 * retain/verify the installation and journal unknown outcomes. */
export async function createProfileWorkbenchInstaller(ctx: Context, authorize: () => void) {
  const profile = ctx.get('profileContext') as ProfileContext | undefined;
  if (!profile) throw new Error('workbench/host-services-unavailable');
  const captured = { ...profile, packageManager: profile.packageManager && {
    command: profile.packageManager.command, args: [...profile.packageManager.args], env: { ...profile.packageManager.env },
  } };
  const directory = await realpath(captured.dir);
  const require = createRequire(captured.installAnchor);
  const operations = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-manager/operations')).href);
  const atomic = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-atomic-write')).href);
  if (typeof operations.runProfilePnpm !== 'function' || typeof atomic.withFileLock !== 'function') throw new Error('workbench/installer-unavailable');
  return async (retainedPath: string, signal?: AbortSignal, beforeInstall?: () => Promise<void>) => {
    const check = () => {
      signal?.throwIfAborted(); ctx.fiber.assertActive(); authorize();
      const current = ctx.get('profileContext') as ProfileContext | undefined;
      if (!current || current.name !== captured.name || current.dir !== captured.dir || current.installAnchor !== captured.installAnchor ||
          current.home !== captured.home || current.cwd !== captured.cwd || JSON.stringify(current.packageManager && { command: current.packageManager.command, args: [...current.packageManager.args], env: { ...current.packageManager.env } }) !== JSON.stringify(captured.packageManager))
        throw new Error('workbench/installation-target-changed');
    };
    check();
    const path = await realpath(retainedPath);
    if (await realpath(captured.dir) !== directory || path !== retainedPath ||
        dirname(path) !== join(directory, '.workdsh-workbench-archives') || !/^[a-f0-9]{64}\.tgz$/.test(basename(path)))
      throw new Error('workbench/archive-path-outside');
    check();
    // Share the official manager's lock so the final baseline check and package
    // mutation cannot be separated by another CLI or Host package operation.
    const result = await atomic.withFileLock(join(directory, 'package.json'), async () => {
      check();
      await beforeInstall?.();
      check();
      return operations.runProfilePnpm({ profile: captured.name, dir: directory,
        cwd: captured.cwd, home: captured.home, installAnchor: captured.installAnchor },
      ['add', path, '--ignore-scripts'], { ...captured.packageManager, execution: 'service', signal,
        outputBytes: 16_384, activateNewBundles: false, lockWaitMs: 10_000, idleTimeoutMs: 30_000, lookupTimeoutMs: 10_000 });
    }, { waitMs: 10_000 });
    check();
    return Object.freeze({ exitCode: typeof result.exitCode === 'number' ? result.exitCode : -1 });
  };
}
