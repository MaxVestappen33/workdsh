/**
 * 会话迁移插件 Host 侧入口：注册 7 个 /api 路由并统一处理登录、错误与进度。
 *
 * 装配方式对齐 packages/plugins/session-recycle：
 * - `inject: ['connection']`，其余服务一律 `ctx.get` 按需读取；
 * - 每个 path 单独 register，`ctx.effect` 负责卸载时反注册；
 * - 任何异常都自己接住并转成 JSON，避免桥接层给出空 body 的 400。
 *
 * 版本红线：currentVersion 只从 catalog 读取，绝不硬编码 4。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ERR, ROUTES, TransferError } from './constants.js'
import type {
  ApplyRequest, ArchivePolicy, Decision, ExportRequest, JobStatus, WorkspaceMapping,
} from './types.js'
import { JobStore, progressPercent } from './jobs.js'
import {
  failure, json, loadCatalog, loadLogExport, requireActor, services, startProjectionTitleBackfill, toFailure, warn,
} from './host.js'
import type { CatalogLike, HostContext, LogExportLike } from './host.js'
import { exportArchive, exportList, exportPreview, writeExportAudit } from './export.js'
import type { ExportContext } from './export.js'
import { importApply, importPreview } from './import.js'
import type { ImportContext } from './import.js'

export const name = 'workdsh-plugin-session-transfer'
export const inject = ['connection']

type Handler =
  | 'exportPreview' | 'exportRun' | 'exportStatus'
  | 'importPreview' | 'importApply' | 'importStatus' | 'importCancel'

interface RouteDef {
  readonly path: string
  readonly methods: readonly ('GET' | 'POST')[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly handler: Handler
}

/** 上传必须走 streaming，绕开 buffered 的 300 MiB 默认上限。 */
const ROUTE_DEFS: readonly RouteDef[] = Object.freeze([
  { path: ROUTES.exportPreview, methods: ['POST'], requestBody: 'buffered', handler: 'exportPreview' },
  { path: ROUTES.exportRun, methods: ['POST'], requestBody: 'buffered', handler: 'exportRun' },
  { path: ROUTES.exportStatus, methods: ['GET'], requestBody: 'buffered', handler: 'exportStatus' },
  { path: ROUTES.importPreview, methods: ['POST'], requestBody: 'streaming', handler: 'importPreview' },
  { path: ROUTES.importApply, methods: ['POST'], requestBody: 'buffered', handler: 'importApply' },
  { path: ROUTES.importStatus, methods: ['GET'], requestBody: 'buffered', handler: 'importStatus' },
  { path: ROUTES.importCancel, methods: ['POST'], requestBody: 'buffered', handler: 'importCancel' },
])

interface PluginState {
  readonly ctx: HostContext
  readonly home: string
  readonly jobs: JobStore
  catalog?: Promise<CatalogLike>
  logExport?: Promise<LogExportLike>
}

interface CommonContext {
  readonly ctx: HostContext
  readonly services: ReturnType<typeof services>
  readonly catalog: CatalogLike
  readonly actor: { principalId: string; organizationId: string; requestId: string }
  readonly home: string
}

export function apply(context: Context): void {
  const ctx = context as unknown as HostContext
  const home = process.env.DSH_HOME?.trim() ?? ''
  const state: PluginState = {
    ctx,
    home,
    // DSH_HOME 缺失时仍给一个可用根；具体请求会在 dispatch 里以 transfer/no-home 拒绝。
    jobs: new JobStore(home === '' ? join(homedir(), '.workdsh') : home),
  }

  ctx.provide('workdshSessionTransfer', Object.freeze({ routes: ROUTES }))
  // 历史导入会话没有官方投影缓存，侧栏只能显示「未命名」；这里启动后补一次。
  startProjectionTitleBackfill(ctx)

  ctx.effect(() => {
    const stops = ROUTE_DEFS.map((route) => ctx.connection.fetch.register({
      path: route.path,
      methods: route.methods,
      requestBody: route.requestBody,
      fetch: (request: Request) => dispatch(state, route, request),
    }))
    const timer = setInterval(() => state.jobs.sweep(), 5 * 60 * 1000)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    return () => {
      clearInterval(timer)
      for (const stop of [...stops].reverse()) void stop()
    }
  }, 'workdsh.session-transfer')
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

async function dispatch(state: PluginState, route: RouteDef, request: Request): Promise<Response> {
  try {
    if (!route.methods.includes(request.method as 'GET' | 'POST')) {
      return failure(405, ERR.invalidRequest, '请求方法不支持。')
    }
    if (state.home === '') {
      throw new TransferError(ERR.noHome, '未找到 DSH_HOME，无法定位会话数据目录。')
    }
    const svc = services(state.ctx)
    const actor = await requireActor(svc.identity, request.signal)
    const [catalog, logExport] = await Promise.all([catalogOf(state), logExportOf(state)])
    const common: CommonContext = { ctx: state.ctx, services: svc, catalog, actor, home: state.home }

    switch (route.handler) {
      case 'exportPreview': {
        const exportRequest = await readExportRequest(request)
        const context = exportContext(common, logExport)
        // 空选 = 只列举会话（选择页）；有选 = 统计选中内容（预览页）。
        return json(exportRequest.sessionIds.length === 0
          ? await exportList(context)
          : await exportPreview(context, exportRequest))
      }
      case 'exportRun':
        return await runExport(state, common, logExport, request)
      case 'exportStatus':
        return exportStatus(state, request)
      case 'importPreview':
        return json(await importPreview(importContext(common, state.jobs), await uploadBody(request), request.signal))
      case 'importApply':
        return json({ batchId: await importApply(importContext(common, state.jobs), await readApplyRequest(request)) })
      case 'importStatus':
        return importStatus(state, request)
      case 'importCancel':
        return await cancelImport(state, request)
    }
  } catch (error) {
    const converted = toFailure(error)
    warn(state.ctx, `会话迁移 ${route.handler} 失败：${converted.code} ${converted.message}`)
    return failure(converted.status, converted.code, converted.message)
  }
}

function catalogOf(state: PluginState): Promise<CatalogLike> {
  state.catalog ??= loadCatalog()
  return state.catalog
}

function logExportOf(state: PluginState): Promise<LogExportLike> {
  state.logExport ??= loadLogExport()
  return state.logExport
}

function exportContext(common: CommonContext, logExport: LogExportLike): ExportContext {
  return { ...common, logExport }
}

function importContext(common: CommonContext, jobs: JobStore): ImportContext {
  return {
    ctx: common.ctx, services: common.services, catalog: common.catalog,
    jobs, actor: common.actor, home: common.home,
  }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

async function runExport(
  state: PluginState, common: CommonContext, logExport: LogExportLike, request: Request,
): Promise<Response> {
  const exportRequest = await readExportRequest(request)
  const context = exportContext(common, logExport)
  const { jobId } = state.jobs.createExport()
  let lastDone = 0
  let lastTotal = 0

  const archive = await exportArchive(context, exportRequest, request.signal, (info) => {
    lastDone = info.done
    lastTotal = info.total
    const status: JobStatus = {
      phase: info.phase,
      percent: progressPercent(info.done, info.total),
      done: info.done,
      total: info.total,
      current: info.current,
      cancellable: false,
      state: 'running',
    }
    state.jobs.setExport(jobId, status)
  })

  const stream = observeStream(
    archive.stream,
    () => {
      const status: JobStatus = {
        phase: 'done', percent: 100, done: lastDone, total: lastTotal,
        current: '导出完成', cancellable: false, state: 'done',
      }
      state.jobs.setExport(jobId, status)
      // 用流完成后的最终 manifest，保证审计统计与实际包内容一致。
      void writeExportAudit(context, archive.readManifest())
    },
    (cause) => {
      const status: JobStatus = {
        phase: 'done', percent: 0, done: lastDone, total: lastTotal,
        current: '导出已中断', cancellable: false, state: 'failed',
        error: { code: ERR.failed, message: cause instanceof Error ? cause.message : String(cause) },
      }
      state.jobs.setExport(jobId, status)
    },
  )

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${archive.filename}"`,
      'cache-control': 'no-store',
      'x-transfer-job-id': jobId,
    },
  })
}

function exportStatus(state: PluginState, request: Request): Response {
  const jobId = queryParam(request, 'jobId')
  const status = state.jobs.getExport(jobId)
  return status === undefined
    ? failure(404, ERR.notFound, '导出任务不存在或已结束。')
    : json(status)
}

/** 在流被完整消费 / 中断时触发回调，用于收尾进度与审计。 */
function observeStream(
  source: ReadableStream<Uint8Array>,
  onDone: () => void,
  onAbort: (cause: unknown) => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let settled = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          if (!settled) { settled = true; onDone() }
          return
        }
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
        if (!settled) { settled = true; onAbort(error) }
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => undefined)
      if (!settled) { settled = true; onAbort(reason) }
    },
  })
}

// ---------------------------------------------------------------------------
// 导入
// ---------------------------------------------------------------------------

function importStatus(state: PluginState, request: Request): Response {
  const batchId = queryParam(request, 'batchId')
  const batch = state.jobs.getBatch(batchId)
  return batch === undefined
    ? failure(404, ERR.notFound, '导入批次不存在或已结束。')
    : json(batch.status)
}

async function cancelImport(state: PluginState, request: Request): Promise<Response> {
  const raw = await readJson<Record<string, unknown>>(request)
  const batchId = typeof raw.batchId === 'string' ? raw.batchId : ''
  if (batchId === '') throw new TransferError(ERR.invalidRequest, '缺少 batchId。')
  return json({ cancelled: state.jobs.requestCancel(batchId) })
}

// ---------------------------------------------------------------------------
// 请求窄化 / 通用 helpers
// ---------------------------------------------------------------------------

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new TransferError(ERR.invalidRequest, '请求格式不正确。')
  }
}

function strArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function archivePolicyOf(value: unknown): ArchivePolicy {
  return value === 'none' ? 'none' : 'preserve'
}

async function readExportRequest(request: Request): Promise<ExportRequest> {
  const raw = await readJson<Record<string, unknown>>(request)
  const sessionIds = strArray(raw.sessionIds)
  return {
    sessionIds,
    includeWorkspaceFiles: raw.includeWorkspaceFiles === true,
    ...(Array.isArray(raw.fileWorkspaceIds) ? { fileWorkspaceIds: strArray(raw.fileWorkspaceIds) } : {}),
    ...(Array.isArray(raw.userExcludes) ? { userExcludes: strArray(raw.userExcludes) } : {}),
    archivePolicy: archivePolicyOf(raw.archivePolicy),
  }
}

async function readApplyRequest(request: Request): Promise<ApplyRequest> {
  const raw = await readJson<Record<string, unknown>>(request)
  if (typeof raw.token !== 'string' || raw.token === '') {
    throw new TransferError(ERR.invalidRequest, '导入预览已失效，请重新选择文件。')
  }
  const decisions: Decision[] = Array.isArray(raw.decisions)
    ? raw.decisions.flatMap((item): Decision[] => {
      if (typeof item !== 'object' || item === null) return []
      const value = item as Record<string, unknown>
      if (typeof value.sessionId !== 'string' || typeof value.targetWorkspaceId !== 'string') return []
      return [{ sessionId: value.sessionId, importAsNew: value.importAsNew === true, targetWorkspaceId: value.targetWorkspaceId }]
    })
    : []
  const mapping: WorkspaceMapping[] = Array.isArray(raw.mapping)
    ? raw.mapping.flatMap((item): WorkspaceMapping[] => {
      if (typeof item !== 'object' || item === null) return []
      const value = item as Record<string, unknown>
      if (typeof value.id !== 'string' || typeof value.targetId !== 'string' || typeof value.targetPath !== 'string') return []
      const status = value.status
      if (status !== 'matched' && status !== 'fallback' && status !== 'missing' && status !== 'invalid') return []
      return [{
        id: value.id,
        title: typeof value.title === 'string' ? value.title : value.id,
        sourcePath: typeof value.sourcePath === 'string' ? value.sourcePath : '',
        targetId: value.targetId,
        targetPath: value.targetPath,
        status,
      }]
    })
    : []
  return { token: raw.token, decisions, mapping, archivePolicy: archivePolicyOf(raw.archivePolicy) }
}

/** streaming 路由取原始字节流；body 为空时退回 buffered 读法（兼容桥接差异）。 */
async function uploadBody(request: Request): Promise<ReadableStream<Uint8Array> | null> {
  if (request.body !== null && request.body !== undefined) {
    return request.body as ReadableStream<Uint8Array>
  }
  const buffer = await request.arrayBuffer().catch(() => new ArrayBuffer(0))
  if (buffer.byteLength === 0) return null
  return new Blob([buffer]).stream()
}

function queryParam(request: Request, key: string): string {
  try {
    return new URL(request.url, 'http://localhost').searchParams.get(key) ?? ''
  } catch {
    return ''
  }
}
