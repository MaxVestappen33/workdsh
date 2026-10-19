import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ActorContext } from 'workdsh-contracts';
import type { VerifyWorkbenchDevelopmentSession } from './development-service.js';

/** Host supplies its protected cold inspector and existing access service.
 * Native inspection uses SessionInspection.meta.cwd; it must not resume Agent.
 * Ownership is checked separately because a native header is not an ACL. */
export function createWorkbenchDevelopmentSessionVerifier(sessionId: string, ports: {
  authorize(actor: ActorContext, sessionId: string, signal?: AbortSignal): Promise<void>;
  inspect(sessionId: string, signal?: AbortSignal): Promise<{ readonly meta: { readonly cwd?: string } }>;
}): VerifyWorkbenchDevelopmentSession {
  if (!sessionId.trim() || sessionId.length > 128 || /[\u0000-\u001f]/.test(sessionId)) throw new Error('workbench/invalid-development-session');
  return async (actor, development, signal) => {
    signal?.throwIfAborted();
    if (!development.source || development.source.hostId !== development.target.hostId) throw new Error('workbench/development-source-unavailable');
    await ports.authorize(actor, sessionId, signal);
    const inspection = await ports.inspect(sessionId, signal);
    signal?.throwIfAborted();
    if (!inspection.meta.cwd || !isAbsolute(inspection.meta.cwd)) throw new Error('workbench/session-workspace-mismatch');
    const [cwd, source] = await Promise.all([realpath(inspection.meta.cwd), realpath(development.source.directory)]);
    if (cwd !== source) throw new Error('workbench/session-workspace-mismatch');
    await ports.authorize(actor, sessionId, signal);
    signal?.throwIfAborted();
    return Object.freeze({ hostId: development.target.hostId, sessionId });
  };
}
