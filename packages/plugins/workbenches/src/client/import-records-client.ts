import type { WorkbenchImportSelection } from './import-client.js';
export interface WorkbenchImportRecord {
  readonly id: string;
  readonly selection?: WorkbenchImportSelection;
  readonly recoveryUnavailable?: true;
  readonly state: 'intent' | 'running' | 'reconciling' | 'unknown' | 'succeeded' | 'failed';
  readonly updatedAt: string;
}
/** Rebuild recovery inputs from Host-owned records, without local storage paths
 * or generating a new operation identity. Legacy incomplete rows fail closed. */
export function createWorkbenchImportRecordsClient(transport: typeof fetch = fetch) {
  return async (scope: { developmentId: string; packageName: string; workbenchId: string }, signal?: AbortSignal): Promise<readonly WorkbenchImportRecord[]> => {
    const captured = { ...scope };
    const lifetime = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    const response = await transport('/api/workdsh-workbench-import-records', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ developmentId: captured.developmentId }), signal: lifetime });
    const result = await response.json(); lifetime.throwIfAborted();
    if (!response.ok || result?.ok !== true || !Array.isArray(result.value)) throw new Error('workbench/records-unavailable');
    const ids = new Set<string>();
    return Object.freeze(result.value.map((row: Record<string, any>) => {
      const candidate = row?.candidate;
      if (!row || row.developmentId !== captured.developmentId || typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
          typeof row.iterationId !== 'string' || !row.iterationId || !['install', 'update'].includes(row.kind) ||
          !['intent', 'running', 'reconciling', 'unknown', 'succeeded', 'failed'].includes(row.state) ||
          typeof row.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.inputHash) ||
          typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error('workbench/invalid-response');
      ids.add(row.id);
      if (candidate === undefined) return Object.freeze({ id: row.id, state: row.state, updatedAt: row.updatedAt, recoveryUnavailable: true as const });
      if (candidate?.packageName !== captured.packageName || candidate?.workbenchId !== captured.workbenchId ||
          typeof candidate.version !== 'string' || !candidate.version || typeof candidate.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(candidate.sha256) || row.inputHash !== candidate.sha256 ||
          (row.kind === 'update' && (typeof row.expectedInstalledHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.expectedInstalledHash))) ||
          (row.kind === 'install' && row.expectedInstalledHash !== undefined)) throw new Error('workbench/invalid-response');
      return Object.freeze({ id: row.id, state: row.state, updatedAt: row.updatedAt,
        selection: Object.freeze({ developmentId: captured.developmentId, operationId: row.id, iterationId: row.iterationId,
          packageName: captured.packageName, workbenchId: captured.workbenchId, version: candidate.version, sha256: candidate.sha256,
          kind: row.kind, expectedInstalledHash: row.expectedInstalledHash }) });
    }));
  };
}
