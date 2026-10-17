export interface WorkbenchImportSelection {
  readonly developmentId: string; readonly operationId: string; readonly iterationId: string;
  readonly packageName: string; readonly version: string; readonly workbenchId: string; readonly sha256: string;
  readonly kind: 'install' | 'update'; readonly expectedInstalledHash?: string;
}
export interface WorkbenchImportStatus {
  readonly id: string; readonly developmentId: string; readonly iterationId: string;
  readonly state: 'intent' | 'running' | 'reconciling' | 'unknown' | 'succeeded' | 'failed';
  readonly kind: 'install' | 'update'; readonly inputHash: string; readonly revision: string;
  readonly receipt?: { readonly package: { readonly packageName: string; readonly version: string; readonly sha256: string }; readonly pendingRestart: boolean };
  readonly errorCode?: string;
}
/** Caller keeps the immutable operation selection after interruption. Explicit
 * recovery only inspects that operation; this transport never retries a POST. */
export function createWorkbenchImportClient(transport: typeof fetch = fetch) {
  return async (selection: WorkbenchImportSelection, recover: boolean, signal?: AbortSignal): Promise<WorkbenchImportStatus> => {
    const input = { developmentId: selection.developmentId, operationId: selection.operationId, iterationId: selection.iterationId,
      packageName: selection.packageName, version: selection.version, workbenchId: selection.workbenchId,
      sha256: selection.sha256, kind: selection.kind, expectedInstalledHash: selection.expectedInstalledHash, recover };
    const lifetime = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    let result: unknown, response: Response;
    try {
      response = await transport('/api/workdsh-workbench-import', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: lifetime });
      result = await response.json();
    } catch (cause) { lifetime.throwIfAborted(); throw new Error('workbench/import-unconfirmed', { cause }); }
    lifetime.throwIfAborted();
    const envelope = result as { ok?: boolean; value?: WorkbenchImportStatus; error?: { code?: unknown } };
    if (!response.ok || envelope?.ok !== true) {
      const code = envelope?.error?.code;
      throw new Error(typeof code === 'string' && /^workbench\/[a-z-]+$/.test(code) ? code : 'workbench/import-failed');
    }
    const value = envelope.value;
    if (!value || value.id !== input.operationId || value.developmentId !== input.developmentId || value.iterationId !== input.iterationId ||
        value.kind !== input.kind || value.inputHash !== input.sha256 || typeof value.revision !== 'string' || !value.revision ||
        !['intent', 'running', 'reconciling', 'unknown', 'succeeded', 'failed'].includes(value.state)) throw new Error('workbench/invalid-response');
    let receipt: WorkbenchImportStatus['receipt'];
    if (value.state === 'succeeded') {
      const observed = value.receipt;
      if (!observed || typeof observed.pendingRestart !== 'boolean' || observed.package?.packageName !== input.packageName ||
          observed.package.version !== input.version || observed.package.sha256 !== input.sha256) throw new Error('workbench/invalid-response');
      receipt = Object.freeze({ package: Object.freeze({ packageName: input.packageName, version: input.version, sha256: input.sha256 }), pendingRestart: observed.pendingRestart });
    } else if (value.receipt !== undefined) throw new Error('workbench/invalid-response');
    return Object.freeze({ id: value.id, developmentId: value.developmentId, iterationId: value.iterationId,
      state: value.state, kind: value.kind, inputHash: value.inputHash, revision: value.revision, receipt,
      errorCode: typeof value.errorCode === 'string' && /^workbench\/[a-z-]+$/.test(value.errorCode) ? value.errorCode : undefined });
  };
}
