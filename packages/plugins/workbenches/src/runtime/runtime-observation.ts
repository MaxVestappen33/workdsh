export type WorkbenchRuntimeStatus = 'unknown' | 'loading' | 'failed' | 'active' | 'unloading';
export interface WorkbenchPluginObservation {
  readonly entryId: string;
  readonly enabled: boolean;
  readonly fiberPhase: 'pending' | 'loading' | 'failed' | 'active' | 'unloading' | null;
}
/** Match public inventory entry identities, never module names or private fibers.
 * Active components do not by themselves prove managed business registration. */
export function observeWorkbenchRuntime(bundle: {
  readonly error?: unknown;
  readonly rows?: readonly { readonly entryId?: string }[];
}, plugins: readonly WorkbenchPluginObservation[]): WorkbenchRuntimeStatus {
  if (bundle.error) return 'failed';
  const entries = (bundle.rows ?? []).map(row => {
    const matches = plugins.filter(plugin => row.entryId !== undefined && plugin.entryId === row.entryId);
    return matches.length === 1 ? matches[0] : undefined;
  });
  const selected = entries.filter(entry => entry?.enabled);
  if (selected.some(entry => entry?.fiberPhase === 'failed')) return 'failed';
  if (selected.some(entry => entry?.fiberPhase === 'unloading')) return 'unloading';
  if (selected.some(entry => entry?.fiberPhase === 'loading' || entry?.fiberPhase === 'pending')) return 'loading';
  if (entries.length && entries.every(entry => entry !== undefined) && selected.length && selected.every(entry => entry?.fiberPhase === 'active')) return 'active';
  return 'unknown';
}
