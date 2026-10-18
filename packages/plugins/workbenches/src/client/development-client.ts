import {parseSourceCheckpoints,parseVerifiedSourceCheckpoint} from './source-checkpoints.js';
import { parseWorkbenchDevelopmentIndexEntry } from 'workdsh-contracts';
export class WorkbenchDevelopmentRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super('开发操作未完成，请核对实际状态。'); }
}
export function createWorkbenchDevelopmentClient(transport: typeof fetch = fetch) {
  async function invoke<T>(endpoint: string, payload: unknown, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const requestSignal = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    requestSignal.throwIfAborted();
    const response = await transport('/api/workdsh-workbench-development', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }), signal: requestSignal });
    requestSignal.throwIfAborted();
    let value: unknown;
    try { value = await response.json(); } catch { throw new WorkbenchDevelopmentRequestError('workbench/invalid-response', response.status); }
    requestSignal.throwIfAborted();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkbenchDevelopmentRequestError('workbench/invalid-response', response.status);
    const result = value as { ok?: unknown; value?: unknown; error?: { code?: unknown } };
    if (!response.ok || result.ok !== true) throw new WorkbenchDevelopmentRequestError(typeof result.error?.code === 'string' ? result.error.code : 'workbench/request-failed', response.status);
    try { return parse(result.value); } catch { throw new WorkbenchDevelopmentRequestError('workbench/invalid-response', response.status); }
  }
  const match = (value: unknown, developmentId: string, requirementsRevision: string, workbenchId?: string, packageName?: string) => {
    const entry = parseWorkbenchDevelopmentIndexEntry(value);
    if (entry.development.id !== developmentId || entry.development.requirementsRevision !== requirementsRevision ||
      (workbenchId !== undefined && entry.development.workbenchId !== workbenchId) ||
      (packageName !== undefined && entry.development.packageName !== packageName)) throw new Error('invalid-development-response');
    return entry;
  };
  return {
    verifySourceCheckpoint:(developmentId:string,sha256:string,signal?:AbortSignal)=>invoke('verify-source-checkpoint',{developmentId,sha256},value=>parseVerifiedSourceCheckpoint(value,sha256),signal),
    sourceCheckpoints:(developmentId:string,signal?:AbortSignal)=>invoke('source-checkpoints',{developmentId},parseSourceCheckpoints,signal),
    identityScope: (signal?: AbortSignal) => invoke('identity-scope', {}, value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-scope');
      const scope = value as Record<string, unknown>;
      for (const key of ['organizationId', 'principalId']) {
        if (typeof scope[key] !== 'string' || !(scope[key] as string).trim() || (scope[key] as string).length > 128) throw new Error('invalid-scope');
      }
      return Object.freeze({ organizationId: scope.organizationId as string, principalId: scope.principalId as string });
    }, signal),
    ensureSession: (developmentId: string, expectedDevelopmentRevision: string, signal?: AbortSignal) =>
      invoke('ensure-session', { developmentId, expectedDevelopmentRevision }, value => {
        const entry = parseWorkbenchDevelopmentIndexEntry(value);
        if (entry.development.id !== developmentId || !entry.development.session) throw new Error('invalid-development-response');
        return entry;
      }, signal),
    create: (developmentId: string, workbenchId: string, packageName: string, expectedRequirementsRevision: string, signal?: AbortSignal) =>
      invoke('create', { developmentId, workbenchId, packageName, expectedRequirementsRevision },
        value => match(value, developmentId, expectedRequirementsRevision, workbenchId, packageName), signal),
    advanceRequirements: (developmentId: string, expectedRequirementsRevision: string, expectedDevelopmentRevision: string, signal?: AbortSignal) =>
      invoke('advance-requirements', { developmentId, expectedRequirementsRevision, expectedDevelopmentRevision },
        value => match(value, developmentId, expectedRequirementsRevision), signal),
    list: (signal?: AbortSignal) => invoke('list', {}, value => {
      if (!Array.isArray(value)) throw new Error('invalid-list');
      const entries = value.map(parseWorkbenchDevelopmentIndexEntry), ids = new Set<string>();
      const owner = entries[0]?.development.owner;
      for (const entry of entries) {
        if (ids.has(entry.development.id) || entry.development.owner.organizationId !== owner?.organizationId || entry.development.owner.ownerPrincipalId !== owner?.ownerPrincipalId) throw new Error('invalid-list');
        ids.add(entry.development.id);
      }
      return Object.freeze(entries);
    }, signal),
  };
}
