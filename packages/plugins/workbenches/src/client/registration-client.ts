import { parseWorkbenchDescriptor, workbenchActivationState } from 'workdsh-contracts';
import type { VerifyClientWorkbenchInstallation } from './client-registration.js';
/** Read installation facts only. Client Loader ownership is checked separately
 * by ClientWorkbenchRegistration, never inferred from this request payload. */
export function createWorkbenchRegistrationClient(transport: typeof fetch = fetch): VerifyClientWorkbenchInstallation {
  return async (packageName, signal) => {
    const lifetime = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    const response = await transport('/api/workdsh-workbench-registration', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'client-authority', payload: { packageName } }), signal: lifetime });
    const result = await response.json(); lifetime.throwIfAborted();
    if (!response.ok || result?.ok !== true) throw new Error('workbench/installation-unconfirmed');
    const value = result.value;
    if (!value || value.package?.packageName !== packageName || value.enabled !== true || typeof value.compatible !== 'boolean')
      throw new Error('workbench/invalid-response');
    const receipt = Object.freeze({ packageName, version: value.package.version, sha256: value.package.sha256 });
    workbenchActivationState({ installed: receipt, enabled: true, compatible: value.compatible });
    return Object.freeze({ descriptor: parseWorkbenchDescriptor(value.descriptor), package: receipt, enabled: true, compatible: value.compatible });
  };
}
