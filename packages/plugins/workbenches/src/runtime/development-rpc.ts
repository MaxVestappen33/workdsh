import type { WorkbenchDevelopmentService } from './development-service.js';
import { readWorkbenchRequestBody } from './request-body.js';
export const workbenchDevelopmentPath = '/api/workdsh-workbench-development';
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 128;
const fail = (code: string, message: string, status: number) => Response.json({ ok: false, error: { code, message, details: {} } }, { status });
export async function handleWorkbenchDevelopmentRequest(request: Request, service: Pick<WorkbenchDevelopmentService, 'list' | 'create' | 'advanceRequirements'> & Partial<Pick<WorkbenchDevelopmentService, 'ensureSession' | 'identityScope' | 'sourceCheckpoints' | 'verifySourceCheckpoint' | 'prepareSourceRecovery'>>): Promise<Response> {
  if (request.method !== 'POST') return fail('workbench/invalid-method', '请使用 POST 请求。', 405);
  try {
    const body = object(await readWorkbenchRequestBody(request)), payload = object(body?.payload);
    if (!body || !payload || Object.keys(body).some(key => !['endpoint', 'payload'].includes(key))) throw new Error('workbench/invalid-request');
    const keys = Object.keys(payload);
    if(body.endpoint==='prepare-source-recovery'&&keys.length===3&&keys.every(key=>['developmentId','expectedDevelopmentRevision','sha256'].includes(key))&&id(payload.developmentId)&&id(payload.expectedDevelopmentRevision)&&typeof payload.sha256==='string'&&/^[a-f0-9]{64}$/.test(payload.sha256)){
      if(!service.prepareSourceRecovery)throw new Error('workbench/checkpoint-service-unavailable');
      return Response.json({ok:true,value:await service.prepareSourceRecovery(payload.developmentId,payload.expectedDevelopmentRevision,payload.sha256,request.signal)});
    }
    if(body.endpoint==='verify-source-checkpoint'&&keys.length===2&&keys.every(key=>['developmentId','sha256'].includes(key))&&id(payload.developmentId)&&typeof payload.sha256==='string'&&/^[a-f0-9]{64}$/.test(payload.sha256)){
      if(!service.verifySourceCheckpoint)throw new Error('workbench/checkpoint-service-unavailable');
      return Response.json({ok:true,value:await service.verifySourceCheckpoint(payload.developmentId,payload.sha256,request.signal)});
    }
    if(body.endpoint==='source-checkpoints'&&keys.length===1&&id(payload.developmentId)){
      if(!service.sourceCheckpoints)throw new Error('workbench/checkpoint-service-unavailable');
      return Response.json({ok:true,value:await service.sourceCheckpoints(payload.developmentId,request.signal)});
    }
    if (body.endpoint === 'ensure-session' && keys.every(key => ['developmentId', 'expectedDevelopmentRevision'].includes(key)) &&
      id(payload.developmentId) && id(payload.expectedDevelopmentRevision)) {
      if (!service.ensureSession) throw new Error('workbench/session-authority-unavailable');
      return Response.json({ ok: true, value: await service.ensureSession(payload.developmentId, payload.expectedDevelopmentRevision, request.signal) });
    }
    if (body.endpoint === 'identity-scope' && keys.length === 0) {
      if (!service.identityScope) throw new Error('workbench/session-authority-unavailable');
      return Response.json({ ok: true, value: await service.identityScope(request.signal) });
    }
    if (body.endpoint === 'list' && keys.length === 0) return Response.json({ ok: true, value: await service.list(request.signal) });
    if (body.endpoint === 'create' && keys.every(key => ['developmentId', 'workbenchId', 'packageName', 'expectedRequirementsRevision'].includes(key)) &&
      id(payload.developmentId) && id(payload.workbenchId) && typeof payload.packageName === 'string' && payload.packageName.length <= 214 && id(payload.expectedRequirementsRevision)) {
      return Response.json({ ok: true, value: await service.create(payload.developmentId, payload.workbenchId, payload.packageName, payload.expectedRequirementsRevision, request.signal) });
    }
    if (body.endpoint === 'advance-requirements' && keys.every(key => ['developmentId', 'expectedRequirementsRevision', 'expectedDevelopmentRevision'].includes(key)) &&
      id(payload.developmentId) && id(payload.expectedRequirementsRevision) && id(payload.expectedDevelopmentRevision)) {
      return Response.json({ ok: true, value: await service.advanceRequirements(payload.developmentId, payload.expectedRequirementsRevision, payload.expectedDevelopmentRevision, request.signal) });
    }
    throw new Error('workbench/invalid-request');
  } catch (cause) {
    if (request.signal.aborted) return fail('workbench/request-cancelled', '操作已取消。', 408);
    const code = cause instanceof Error ? cause.message : '';
    if(['workbench/source-revision-conflict','workbench/source-recovery-busy'].includes(code))return fail(code,'源码已变化或另一个恢复操作正在进行，请核对当前状态。',409);
    if(code==='workbench/checkpoint-corrupt')return fail(code,'源码备份完整性校验未通过，不能用于恢复。',409);
    if(code==='workbench/checkpoint-service-unavailable')return fail(code,'源码恢复点服务尚未就绪。',503);
    if (code === 'workbench/installation-target-changed') return fail(code, '开发记录与当前运行环境不一致，请核对原环境与源码关联。', 409);
    if (['workbench/development-source-unavailable', 'workbench/source-identity-mismatch', 'workbench/source-directory-outside'].includes(code)) return fail(code, '源码关联未通过核对，需求和已有会话已保留。', 409);
    if (code === 'workbench/session-authority-unavailable') return fail(code, '开发会话服务尚未就绪。', 503);
    if (code === 'workbench/development-creator-required') return fail(code, '开发会话未启用官方创造模式，需求和源码已保留。', 409);
    if (['workbench/requirements-revision-conflict', 'workbench/development-revision-conflict', 'workbench/development-conflict', 'workbench/development-identity-conflict'].includes(code)) return fail(code, '开发记录已有变化或身份冲突，请保留修改并核对最新状态。', 409);
    if (['workbench/development-access-denied', 'workbench/development-owner-mismatch'].includes(code)) return fail('workbench/development-access-denied', '当前身份无权访问这份开发记录。', 403);
    if (code === 'workbench/development-not-found') return fail(code, '未找到开发记录，请核对来源。', 404);
    if (code === 'workbench/request-size-limit') return fail(code, '请求内容超过大小限制。', 413);
    if (['workbench/invalid-request', 'workbench/invalid-development-identity'].includes(code)) return fail(code, '开发请求无效，请检查内容。', 400);
    return fail('workbench/internal', '操作未完成，请核对实际状态。', 500);
  }
}
