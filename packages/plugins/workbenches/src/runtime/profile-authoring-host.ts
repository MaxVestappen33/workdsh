import type { Context } from '@deepseek-ai/cordis';
import type { VerifyWorkbenchDevelopmentSource } from './development-service.js';
import { createProfileWorkbenchTarget } from './profile-target.js';
import { mountWorkbenchAuthoringHost } from './authoring-host.js';
import { createNativeWorkbenchDevelopmentSessionVerifier } from './native-development-session.js';
import { createNativeWorkbenchDevelopmentSession } from './create-development-session.js';
import { createProfileWorkbenchDevelopmentSourceVerifier } from './profile-development-source.js';

/** Current Profile target derives from launcher facts, never client configuration. */
export async function mountProfileWorkbenchAuthoringHost(ctx: Context, sourceVerifier?: VerifyWorkbenchDevelopmentSource) {
  const target = await createProfileWorkbenchTarget(ctx);
  ctx.fiber.assertActive();
  const authoring = mountWorkbenchAuthoringHost(ctx, target, async (actor, development, signal) => {
    const created = await createNativeWorkbenchDevelopmentSession(ctx, actor, development, development.workbenchId.slice(0, 80), signal);
    return createNativeWorkbenchDevelopmentSessionVerifier(ctx, created.sessionId)(actor, development, signal);
  }, sourceVerifier ?? createProfileWorkbenchDevelopmentSourceVerifier(ctx));
  return Object.freeze({ ...authoring,
    /** Use the same source/session orchestration as the public RPC. */
    ensureSession: (developmentId: string, expectedRevision: string, signal?: AbortSignal) =>
      authoring.development.ensureSession(developmentId, expectedRevision, signal),
    /** Internal owner calls after native creation and access binding. */
    bindSession: (developmentId: string, expectedRevision: string, sessionId: string, signal?: AbortSignal) =>
      authoring.development.bindVerifiedSession(developmentId, expectedRevision,
        createNativeWorkbenchDevelopmentSessionVerifier(ctx, sessionId), signal),
  });
}
