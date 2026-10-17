import { readWorkbenchRequestBody } from './request-body.js';
import type { WorkbenchRequirementsService } from './requirements-service.js';

export const workbenchRequirementsPath = '/api/workdsh-workbench-requirements';
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const fail = (code: string, message: string, status: number) => Response.json({ ok: false, error: { code, message, details: {} } }, { status });
/** Official connection adapter delegates here; identity resolution stays entirely in the service. */
export async function handleWorkbenchRequirementsRequest(request: Request, service: Pick<WorkbenchRequirementsService, 'history' | 'append'>): Promise<Response> {
  if (request.method !== 'POST') return fail('workbench/invalid-method', '请使用 POST 请求。', 405);
  try {
    const body = record(await readWorkbenchRequestBody(request));
    const payload = record(body?.payload);
    if (!body || !payload || Object.keys(body).some(key => !['endpoint', 'payload'].includes(key)) || Object.keys(payload).some(key => !['developmentId', 'requirements', 'expectedRevisionId'].includes(key)) || typeof payload.developmentId !== 'string' || !payload.developmentId.trim() || payload.developmentId.length > 128) throw new Error('workbench/invalid-request');
    if (payload.expectedRevisionId !== undefined && (typeof payload.expectedRevisionId !== 'string' || !payload.expectedRevisionId || payload.expectedRevisionId.length > 128)) throw new Error('workbench/invalid-request');
    if (body.endpoint === 'history') return Response.json({ ok: true, value: await service.history(payload.developmentId, request.signal) });
    if (body.endpoint === 'append') return Response.json({ ok: true, value: await service.append(payload.developmentId, payload.requirements, payload.expectedRevisionId as string | undefined, request.signal) });
    throw new Error('workbench/invalid-request');
  } catch (cause) {
    if (request.signal.aborted) return fail('workbench/request-cancelled', '操作已取消。', 408);
    const code = cause instanceof Error ? cause.message : '';
    if (code === 'workbench/requirements-revision-conflict') return fail(code, '需求已有新修订，请保留当前修改并核对最新版本。', 409);
    if (code === 'workbench/development-access-denied') return fail(code, '当前身份无权访问这份开发记录。', 403);
    if (code === 'workbench/request-size-limit') return fail(code, '请求内容超过大小限制。', 413);
    if (['workbench/invalid-request', 'workbench/invalid-requirements', 'workbench/invalid-system-definition', 'workbench/invalid-development-id'].includes(code)) return fail(code, '需求请求无效，请检查内容。', 400);
    return fail('workbench/internal', '操作未完成，请刷新后核对。', 500);
  }
}
