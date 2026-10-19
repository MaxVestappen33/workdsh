import type { WorkbenchUploadSelection } from './upload-client.js';
export interface WorkbenchImportPreparation {
  readonly kind: 'install' | 'update';
  readonly package: { readonly packageName: string; readonly version: string; readonly sha256: string };
  readonly installedVersion?: string; readonly expectedInstalledHash?: string;
}
export function createWorkbenchImportPreparationClient(transport: typeof fetch = fetch) {
  return async (selection: WorkbenchUploadSelection & { readonly sha256: string }, signal?: AbortSignal): Promise<WorkbenchImportPreparation> => {
    const input = { developmentId: selection.developmentId, packageName: selection.packageName, version: selection.version,
      workbenchId: selection.workbenchId, sha256: selection.sha256 };
    const lifetime = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    const response = await transport('/api/workdsh-workbench-import-prepare', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: lifetime });
    const result = await response.json(); lifetime.throwIfAborted();
    if (!response.ok || result?.ok !== true) throw new Error(typeof result?.error?.code==='string'&&/^workbench\/[a-z-]+$/.test(result.error.code)?result.error.code:'workbench/import-prepare-failed');
    const value = result.value;
    if (!value || !['install', 'update'].includes(value.kind) || value.package?.packageName !== input.packageName ||
        value.package.version !== input.version || value.package.sha256 !== input.sha256 ||
        (value.kind === 'update' && (typeof value.installedVersion !== 'string' || !value.installedVersion ||
          typeof value.expectedInstalledHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedInstalledHash))) ||
        (value.kind === 'install' && (value.expectedInstalledHash !== undefined || value.installedVersion !== undefined))) throw new Error('workbench/invalid-response');
    return Object.freeze({ kind: value.kind, package: Object.freeze({ packageName: input.packageName, version: input.version, sha256: input.sha256 }),
      installedVersion: value.installedVersion, expectedInstalledHash: value.expectedInstalledHash });
  };
}

/** Offline imports get a Host-owned reference, without creating authoring requirements. */
export function createWorkbenchOfflinePreparationClient(transport: typeof fetch = fetch) {
  return async (selection: Omit<WorkbenchUploadSelection, 'developmentId'> & {readonly sha256:string}, signal?:AbortSignal) => {
    let importId: string | undefined;
    const prepare = createWorkbenchImportPreparationClient(async (_path, options) => {
      const {developmentId: _unused, ...input} = JSON.parse(options!.body as string);
      const response = await transport('/api/workdsh-workbench-offline-prepare', {...options, body:JSON.stringify(input)});
      const envelope = await response.json();
      if (response.ok && envelope?.ok === true) {
        const id = envelope.value?.importId;
        if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new Error('workbench/invalid-response');
        importId = id;
      }
      return Response.json(envelope, {status:response.status});
    });
    const result = await prepare({...selection,developmentId:'offline'},signal);
    if (!importId) throw new Error('workbench/invalid-response');
    return Object.freeze({...result,importId});
  };
}
