export interface WorkbenchUploadSelection {
  readonly developmentId: string;
  readonly packageName: string;
  readonly version: string;
  readonly workbenchId: string;
}
/** Upload only. Retain the caller's Blob for explicit retry; never automatically
 * install or resubmit after network interruption. No filesystem path is sent. */
export function createWorkbenchUploadClient(transport: typeof fetch = fetch) {
  return async (selection: WorkbenchUploadSelection, file: Blob, signal?: AbortSignal) => {
    const metadata = Object.freeze({ developmentId: selection.developmentId, packageName: selection.packageName,
      version: selection.version, workbenchId: selection.workbenchId });
    if (!Object.values(metadata).every(value => typeof value === 'string' && value.trim() && value.length <= 214) ||
        !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(metadata.packageName)) throw new Error('workbench/invalid-request');
    if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('workbench/package-archive-size-limit');
    const lifetime = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    let response: Response;
    try {
      response = await transport('/api/workdsh-workbench-upload', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream', 'x-workdsh-upload': JSON.stringify(metadata) }, body: file, signal: lifetime });
    } catch (cause) {
      lifetime.throwIfAborted();
      throw new Error('workbench/upload-interrupted', { cause });
    }
    lifetime.throwIfAborted();
    const result = await response.json(); lifetime.throwIfAborted();
    if (!response.ok || result?.ok !== true) {
      const code = result?.error?.code;
      throw new Error(typeof code === 'string' && /^workbench\/[a-z-]+$/.test(code) ? code : 'workbench/upload-failed');
    }
    const value = result.value;
    if (!value || Object.entries(metadata).some(([key, expected]) => value[key] !== expected) ||
        typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('workbench/invalid-response');
    return Object.freeze({ ...metadata, sha256: value.sha256 as string });
  };
}
