import { parseWorkbenchDescriptor } from 'workdsh-contracts';
export function createWorkbenchNativeInstallationClient(transport: typeof fetch = fetch) {
  return async (selection: { developmentId: string; expectedRevision: string; version: string; sha256: string; packageName: string; workbenchId: string }, signal?: AbortSignal) => {
    const lifetime = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
    const { developmentId, expectedRevision, version, sha256 } = selection;
    lifetime.throwIfAborted();
    const response = await transport('/api/workdsh-workbench-native-installation', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ developmentId, expectedRevision, version, sha256 }), signal: lifetime });
    const envelope = await response.json(); lifetime.throwIfAborted();
    if (!response.ok || envelope?.ok !== true) throw new Error(typeof envelope?.error?.code === 'string' && /^workbench\/[a-z-]+$/.test(envelope.error.code) ? envelope.error.code : 'workbench/native-installation-unconfirmed');
    const value = envelope.value;
    if (value?.developmentId !== developmentId || value.installedVerified !== true || value.activationVerified !== false ||
      value.package?.packageName !== selection.packageName || value.package.version !== version || value.package.sha256 !== sha256 ||
      parseWorkbenchDescriptor(value.descriptor).id !== selection.workbenchId) throw new Error('workbench/invalid-response');
    return Object.freeze({ developmentId, package: Object.freeze({ packageName: selection.packageName, version, sha256 }),
      descriptor: parseWorkbenchDescriptor(value.descriptor), installedVerified: true as const, activationVerified: false as const });
  };
}
