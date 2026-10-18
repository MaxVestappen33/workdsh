import { readWorkbenchRequestBody } from './request-body.js';
export const workbenchImportPath = '/api/workdsh-workbench-import';
export interface WorkbenchImportRequest {
  developmentId: string; operationId: string; iterationId: string;
  packageName: string; version: string; workbenchId: string; sha256: string;
  kind: 'install' | 'update'; expectedInstalledHash?: string; recover: boolean;
}
export async function handleWorkbenchImportRequest(request: Request,
  execute: (input: WorkbenchImportRequest, signal: AbortSignal) => Promise<unknown>) {
  const failure = (code: string, status: number) => Response.json({ ok: false, error: { code, message: '无法完成插件安装，请核对状态后重试。' } }, { status });
  if (request.method !== 'POST') return failure('workbench/invalid-method', 405);
  try {
    const value = await readWorkbenchRequestBody(request) as Record<string, unknown>;
    const keys = ['developmentId', 'operationId', 'iterationId', 'packageName', 'version', 'workbenchId', 'sha256', 'kind', 'expectedInstalledHash', 'recover'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) ||
        !keys.slice(0, 7).every(key => typeof value[key] === 'string' && value[key].trim() && (value[key] as string).length <= 214) ||
        !/^[a-f0-9]{64}$/.test(value.sha256 as string) || !['install', 'update'].includes(value.kind as string) ||
        typeof value.recover !== 'boolean' || (value.expectedInstalledHash !== undefined &&
          (typeof value.expectedInstalledHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedInstalledHash))) ||
        (value.kind === 'update' && !value.expectedInstalledHash) || (value.kind === 'install' && value.expectedInstalledHash !== undefined))
      throw new Error('workbench/invalid-request');
    const result = await execute(value as unknown as WorkbenchImportRequest, request.signal);
    request.signal.throwIfAborted(); return Response.json({ ok: true, value: result });
  } catch (cause) {
    if (request.signal.aborted) return failure('workbench/request-cancelled', 408);
    const code = cause instanceof Error ? cause.message : '';
    if (code === 'workbench/invalid-request') return failure(code, 400);
    if (code === 'workbench/request-size-limit') return failure(code, 413);
    if (['workbench/development-access-denied', 'workbench/development-owner-mismatch'].includes(code)) return failure(code, 403);
    if (['workbench/operation-not-found', 'workbench/development-not-found'].includes(code)) return failure(code, 404);
    if (/^workbench\/(?:package-[a-z-]+|invalid-manifest|invalid-descriptor|invalid-id)$/.test(code)) return failure(code, 422);
    if (/^workbench\/(?:operation-[a-z-]+|installation-[a-z-]+|incompatible-package)$/.test(code)) return failure(code, 409);
    return failure('workbench/import-failed', 500);
  }
}
