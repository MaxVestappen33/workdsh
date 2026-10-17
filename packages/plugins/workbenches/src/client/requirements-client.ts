import { parseWorkbenchRequirementsDraft, type WorkbenchRequirementsDraft, type WorkbenchRequirementsRevision } from 'workdsh-contracts';

export class WorkbenchRequirementsRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); this.name = 'WorkbenchRequirementsRequestError'; }
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function id(value: unknown): value is string { return typeof value === 'string' && value.length <= 128 && !!value.trim(); }
function revision(value: unknown, developmentId: string): WorkbenchRequirementsRevision {
  // v1 requirements are member-owned. This validates a response; Host authorization
  // must still determine the actual current member and space independently.
  if (!object(value) || !id(value.id) || value.developmentId !== developmentId || !object(value.owner) ||
    !id(value.owner.organizationId) || !id(value.owner.ownerPrincipalId) || value.owner.scope !== 'personal' ||
    value.createdBy !== value.owner.ownerPrincipalId || typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt ||
    (value.parentRevisionId !== undefined && !id(value.parentRevisionId))) throw new Error('invalid-revision');
  return Object.freeze({ id: value.id, developmentId, ...(value.parentRevisionId === undefined ? {} : { parentRevisionId: value.parentRevisionId }),
    owner: Object.freeze({ organizationId: value.owner.organizationId, ownerPrincipalId: value.owner.ownerPrincipalId, scope: 'personal' as const }),
    createdAt: value.createdAt, createdBy: value.createdBy, requirements: parseWorkbenchRequirementsDraft(value.requirements) });
}
export function createWorkbenchRequirementsClient(lifetime?: AbortSignal, transport: typeof fetch = fetch) {
  async function invoke<T>(endpoint: string, payload: unknown, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const signals = [AbortSignal.timeout(30_000), lifetime, signal].filter((value): value is AbortSignal => value !== undefined);
    const requestSignal = AbortSignal.any(signals);
    requestSignal.throwIfAborted();
    const response = await transport('/api/workdsh-workbench-requirements', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }), signal: requestSignal });
    requestSignal.throwIfAborted();
    const invalid = () => new WorkbenchRequirementsRequestError('workbench/invalid-response', '需求服务返回了无效响应，请核对保存状态。', response.status);
    let result: unknown;
    try { result = await response.json(); } catch { throw invalid(); }
    requestSignal.throwIfAborted();
    if (!object(result)) throw invalid();
    if (!response.ok || result.ok !== true || result.value === undefined) {
      const error = object(result.error) ? result.error : undefined;
      throw new WorkbenchRequirementsRequestError(typeof error?.code === 'string' ? error.code : 'workbench/request-failed', typeof error?.message === 'string' ? error.message : '需求操作未完成，请核对保存状态。', response.status);
    }
    try { return parse(result.value); } catch { throw invalid(); }
  }
  return {
    history: (developmentId: string, signal?: AbortSignal) => invoke('history', { developmentId }, value => {
      if (!Array.isArray(value)) throw new Error('invalid-history');
      const parsed = value.map(row => revision(row, developmentId));
      const ids = new Set<string>();
      for (let index = 0; index < parsed.length; index++) {
        const row = parsed[index], previous = parsed[index - 1];
        if (ids.has(row.id) || row.parentRevisionId !== previous?.id || (previous &&
          (row.owner.organizationId !== previous.owner.organizationId || row.owner.ownerPrincipalId !== previous.owner.ownerPrincipalId))) throw new Error('invalid-history');
        ids.add(row.id);
      }
      return Object.freeze(parsed);
    }, signal),
    append: (developmentId: string, requirements: WorkbenchRequirementsDraft, expectedRevisionId?: string, signal?: AbortSignal) => {
      const draft = parseWorkbenchRequirementsDraft(requirements);
      return invoke('append', { developmentId, requirements: draft, ...(expectedRevisionId === undefined ? {} : { expectedRevisionId }) }, value => {
        const saved = revision(value, developmentId);
        if (saved.parentRevisionId !== expectedRevisionId || saved.id === expectedRevisionId || JSON.stringify(saved.requirements) !== JSON.stringify(draft)) throw new Error('invalid-saved-revision');
        return saved;
      }, signal);
    },
  };
}
