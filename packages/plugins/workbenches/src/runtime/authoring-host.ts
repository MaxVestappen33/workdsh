import type { Context } from '@deepseek-ai/cordis';
import type { ResolveWorkbenchDevelopmentTarget, VerifyWorkbenchDevelopmentSession, VerifyWorkbenchDevelopmentSource } from './development-service.js';
import { mountWorkbenchRequirementsHost } from './requirements-host.js';
import { mountWorkbenchDevelopmentHost } from './development-host.js';

/** Internal composition for the future platform entry. No package/Profile activation. */
export function mountWorkbenchAuthoringHost(ctx: Context, resolveTarget: ResolveWorkbenchDevelopmentTarget, sessionVerifier?: VerifyWorkbenchDevelopmentSession, sourceVerifier?: VerifyWorkbenchDevelopmentSource) {
  const requirements = mountWorkbenchRequirementsHost(ctx);
  const development = mountWorkbenchDevelopmentHost(ctx, resolveTarget, requirements, sessionVerifier, sourceVerifier);
  return Object.freeze({ requirements, development });
}
