import { parseWorkbenchDescriptor } from 'workdsh-contracts';
/** First-import discovery reads identity from bytes on the Host. It does not
 * accept a filename as identity or declare installation/activation success. */
export function createWorkbenchPackagePreviewClient(transport: typeof fetch = fetch) {
  return async (file: Blob, signal?: AbortSignal) => {
    if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('workbench/package-archive-size-limit');
    const lifetime = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    const response = await transport('/api/workdsh-workbench-package-preview', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' }, body: file, signal: lifetime });
    const result = await response.json(); lifetime.throwIfAborted();
    if (!response.ok || result?.ok !== true) throw new Error(['workbench/package-macos-metadata','workbench/package-unsupported-entry','workbench/tool-optional-required-false','workbench/tool-schema-invalid','workbench/package-kernel-version-mismatch','workbench/package-cordis-version-mismatch','workbench/package-missing-export','workbench/package-missing-entry'].includes(result?.error?.code) ? result.error.code : 'workbench/package-preview-failed');
    const value = result.value, receipt = value?.package;
    if (!receipt || typeof receipt.packageName !== 'string' || receipt.packageName.length > 214 ||
        !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(receipt.packageName) ||
        typeof receipt.version !== 'string' || !receipt.version || receipt.version.length > 128 ||
        typeof receipt.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.sha256) || typeof value.compatible !== 'boolean')
      throw new Error('workbench/invalid-response');
    return Object.freeze({ package: Object.freeze({ packageName: receipt.packageName as string, version: receipt.version as string, sha256: receipt.sha256 as string }),
      descriptor: parseWorkbenchDescriptor(value.descriptor), compatible: value.compatible as boolean });
  };
}
