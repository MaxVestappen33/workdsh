export interface WorkbenchActivationSelection {
  readonly developmentId?: string; readonly packageName: string; readonly version: string; readonly workbenchId: string; readonly sha256: string;
}
export function createWorkbenchActivationClient(transport: typeof fetch = fetch) {
  return async (selection: WorkbenchActivationSelection, enabled: boolean, signal?: AbortSignal) => {
    const input = { developmentId: selection.developmentId, packageName: selection.packageName, version: selection.version,
      workbenchId: selection.workbenchId, sha256: selection.sha256, enabled };
    const lifetime = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    let response: Response, result: any;
    try {
      response = await transport('/api/workdsh-workbench-activation', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: lifetime });
      result = await response.json();
    } catch (cause) { lifetime.throwIfAborted(); throw new Error('workbench/activation-unconfirmed', { cause }); }
    lifetime.throwIfAborted();
    if (!response.ok || result?.ok !== true) throw new Error('workbench/activation-unconfirmed');
    const value = result.value;
    if (!value || value.packageName !== input.packageName || value.version !== input.version || typeof value.selected !== 'boolean' ||
        typeof value.confirmed !== 'boolean' || typeof value.pendingRestart !== 'boolean' ||
        !['applied', 'restart-required', 'overridden', 'failed', 'cancelled'].includes(value.application) ||
        value.pendingRestart !== (value.application === 'restart-required') ||
        (value.confirmed && (value.application !== 'applied' || value.selected !== enabled))) throw new Error('workbench/invalid-response');
    return Object.freeze({ packageName: input.packageName, version: input.version, selected: value.selected as boolean,
      confirmed: value.confirmed as boolean, pendingRestart: value.pendingRestart as boolean, application: value.application as string });
  };
}
