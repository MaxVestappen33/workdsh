/**
 * DSH 运行时桥接层。
 *
 * 插件只用官方公开服务（ctx.get）与公开 npm 包 exports。官方包通过「变量
 * specifier + 动态 import」加载，避免插件对官方内部 .d.ts 产生编译期绑定，
 * 也让 DSH 升级时无需改插件代码（版本一律从 catalog.currentVersion 读取）。
 */

import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import { ERR, TransferError } from './constants.js'

// ---------------------------------------------------------------------------
// Host Context（只声明本插件实际用到的一面，缺失时给明确错误）
// ---------------------------------------------------------------------------

export interface HostContext {
  connection: {
    fetch: {
      register(route: {
        path: string
        methods: readonly ('GET' | 'HEAD' | 'POST')[]
        requestBody: 'buffered' | 'streaming'
        fetch: (request: Request) => Promise<Response>
      }): () => void | Promise<void>
    }
  }
  effect(callback: () => () => void | Promise<void>, label?: string): void
  provide(name: string, value: unknown): void
  get(service: string): unknown
  logger?: { warn(message: string): void }
}

// ---------------------------------------------------------------------------
// 官方服务的最小接口
// ---------------------------------------------------------------------------

export interface SessionHeaderLike {
  version: number
  id: string
  createdAt: number
  cwd?: string
  parentSession?: string
  isSeeded: boolean
  origin?: 'subagent'
  delegationDepth?: number
  agentPreset?: string
}

export interface SessionSnapshotLike {
  readonly header: SessionHeaderLike
  readonly formatStatus?: 'current' | 'migration-required'
  readonly revision?: number
  readonly eventCount?: number
  readonly sizeBytes?: number
}

export interface SessionHandleLike {
  readonly header: SessionHeaderLike
  readonly inheritedEventCount?: number
  read(offset?: number, length?: number, options?: { signal?: AbortSignal }): Promise<{ events: readonly Record<string, unknown>[] }>
  append(events: readonly Record<string, unknown>[], options?: { signal?: AbortSignal }): Promise<void>
  flush(options?: { signal?: AbortSignal }): Promise<void>
  close(): Promise<void>
}

export interface PersistenceLike {
  list(options?: { signal?: AbortSignal }): Promise<readonly SessionSnapshotLike[]>
  stat(id: string, options?: { signal?: AbortSignal }): Promise<SessionSnapshotLike | undefined>
  open(id: string, access: 'read' | 'write', options?: { signal?: AbortSignal }): Promise<SessionHandleLike>
  create(header: SessionHeaderLike, options?: { inheritedEventCount?: number; signal?: AbortSignal }): Promise<SessionHandleLike>
  flush(): Promise<void>
}

export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
  attachSession(sessionId: string): Promise<void>
}

export interface RegistryLike {
  get(id: string): WorkspaceLike | undefined
  list(): readonly WorkspaceLike[]
  resolveByPath(path: string): Promise<WorkspaceLike | undefined>
  create(path: string, title?: string): Promise<WorkspaceLike>
  delete(id: string): Promise<boolean>
  readonly archivedSessionIds: readonly string[]
  archiveSession(id: string, options?: { stopActivity?: boolean }): Promise<void>
  unarchiveSession(id: string): Promise<void>
  pinSession(id: string): Promise<void>
  unpinSession(id: string): Promise<void>
}

export interface IdentityLike {
  resolve(evidence?: unknown, signal?: AbortSignal): Promise<{
    principalId: string
    organizationId: string
    requestId: string
  }>
}

export interface AuditLike {
  append(event: Record<string, unknown>): Promise<void>
  flush(): Promise<void>
}

export interface AccessLike {
  bindSession(
    actor: { principalId: string; organizationId: string; requestId: string },
    request: { sessionId: string; workspaceId: string },
    signal?: AbortSignal,
  ): Promise<unknown>
  /** 只读查看已有归属；用于跳过同一主体的历史绑定（旧绑定不能被替换）。 */
  sessionOwner?(sessionId: string):
    | { organizationId: string; ownerPrincipalId: string; workspaceId?: string }
    | undefined
}

export interface SessionsLike {
  get(id: string): unknown
  flush(session: unknown, signal?: AbortSignal): Promise<void>
  refresh?(): Promise<void>
}

export interface AttachmentRefLike {
  attachmentId: string
  mediaType?: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}

export interface AttachmentsLike {
  imageHostPath(ref: AttachmentRefLike): string | undefined
  fileHostPath(ref: AttachmentRefLike): string | undefined
  saveImage(input: unknown): Promise<AttachmentRefLike>
  saveFileStream(input: unknown): Promise<AttachmentRefLike>
}

export interface Services {
  persistence: PersistenceLike
  registry: RegistryLike
  identity: IdentityLike
  audit?: AuditLike
  access?: AccessLike
  sessions?: SessionsLike
  attachments?: AttachmentsLike
  facts: SessionFactsReader
}

/** 会话列表所需的投影事实（官方 session/title 与 sessionListMetadata 的只读视图）。 */
export interface SessionFacts {
  /** 标题；无投影数据时为 null，由调用方兜底 */
  readonly title: string | null
  /** 空会话（创建后从未开始 turn）；未知时为 null */
  readonly blank: boolean | null
}

export interface SessionProjectionBlockLike {
  readonly values?: Readonly<Record<string, unknown>>
}

export interface SessionFactsReader {
  read(header: SessionHeaderLike, liveSession: unknown): SessionFacts
}

/** 官方投影缓存的最小接口（读视图 + 冷读折叠写回）。 */
export interface ProjectionCacheLike {
  cachedSnapshot?(meta: unknown): SessionProjectionBlockLike | undefined
  cachedPredecessorTitle?(meta: unknown): SessionProjectionBlockLike | undefined
  coldSnapshot?(meta: unknown, inheritedEventCount: number, events: readonly unknown[]): SessionProjectionBlockLike | undefined
}

/**
 * 为「没有投影缓存」的会话补标题（含本插件导入的会话）。
 *
 * 导入是直接落盘，不会走官方「打开会话」的折叠链路；不补的话官方侧栏与导出列表都只能
 * 显示「未命名 / 会话 id」，只有在侧栏点开会话才生成标题。这里在宿主就绪后用官方冷读
 * 折叠 coldSnapshot 写回缓存，之后侧栏直接就能拿到标题。
 *
 * 只在标题投影单元已生效时执行（以「至少一个会话已有标题投影」为判据），避免写出
 * 没有 title 行的坏缓存记录；单次失败只跳过该会话。
 */
const BACKFILL_DELAYS: readonly number[] = [800, 3000, 8000, 20000]

export function startProjectionTitleBackfill(ctx: HostContext): void {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const attempt = (index: number): void => {
    const delay = BACKFILL_DELAYS[index]
    if (delay === undefined) return
    const timer = setTimeout(() => {
      timers.delete(timer)
      void runTitleBackfill(ctx).then((ready) => { if (!ready) attempt(index + 1) })
    }, delay)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    timers.add(timer)
  }
  attempt(0)
  ctx.effect(() => () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  })
}

/** @returns 宿主组合是否就绪（就绪后不再重试）。 */
async function runTitleBackfill(ctx: HostContext): Promise<boolean> {
  try {
    // 组合未就绪（服务串行装配中）时让调用方稍后重试
    if (ctx.get('sessionController') === undefined) return false
    const cache = ctx.get('sessionProjectionCache') as ProjectionCacheLike | undefined
    if (cache?.coldSnapshot === undefined) return false
    const persistence = ctx.get('sessionPersistence') as PersistenceLike | undefined
    if (persistence === undefined) return false
    const facts = sessionFactsReader(ctx)
    const [catalog, logExport] = await Promise.all([loadCatalog(), loadLogExport()])
    const snapshots = await persistence.list()
    const visible = snapshots.filter((snapshot) => snapshot.header.origin !== 'subagent')
    const needsTitle = visible.filter((snapshot) => {
      const row = facts.read(snapshot.header, undefined)
      if (row.blank === true || row.title !== null) return false
      return cache.cachedSnapshot?.(snapshot.header) === undefined
    })
    if (needsTitle.length === 0) return true
    // 标题投影单元尚未生效时 coldSnapshot 会写出缺 title 的缓存行，宁可跳过
    if (!visible.some((snapshot) => facts.read(snapshot.header, undefined).title !== null)) return true

    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < needsTitle.length) {
        const snapshot = needsTitle[cursor++]
        if (snapshot === undefined) return
        try {
          const text = await logExport.readSessionLogText(persistence, snapshot.header.id)
          if (text === undefined) continue
          const lines = text.split('\n').filter((line) => line !== '')
          const headerValue = JSON.parse(lines[0] ?? '{}') as unknown
          const verdict = catalog.readHeader(headerValue)
          if (verdict.status !== 'current') continue
          const events = lines.slice(1).map((line) => JSON.parse(line) as unknown)
          if (events.length === 0) continue
          cache.coldSnapshot?.(snapshot.header, 0, events)
        } catch {
          // 单个会话失败不影响其它会话
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, needsTitle.length) }, () => worker()))
    return true
  } catch {
    // 回填是尽力而为，不影响功能
    return true
  }
}

/**
 * 从官方投影服务读标题与空会话标记，不读会话日志。
 * 已打开会话走实时投影，冷会话走持久化投影缓存；缺失时返回未知。
 */
export function sessionFactsReader(ctx: HostContext): SessionFactsReader {
  return {
    read(header, liveSession) {
      try {
        let block: SessionProjectionBlockLike | undefined
        if (liveSession !== undefined && liveSession !== null) {
          const live = ctx.get('sessionProjections') as
            { cachedSnapshot?(session: unknown): SessionProjectionBlockLike | undefined } | undefined
          block = live?.cachedSnapshot?.(liveSession)
        } else {
          const cache = ctx.get('sessionProjectionCache') as
            | {
              cachedSnapshot?(meta: unknown): SessionProjectionBlockLike | undefined
              cachedPredecessorTitle?(meta: unknown): SessionProjectionBlockLike | undefined
            }
            | undefined
          block = cache?.cachedSnapshot?.(header) ?? cache?.cachedPredecessorTitle?.(header)
        }
        const values = block?.values
        if (values === undefined) return { title: null, blank: null }
        const rawTitle = values.title
        const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : null
        const metadata = values.sessionListMetadata
        const blank = typeof metadata === 'object' && metadata !== null
          && typeof (metadata as Record<string, unknown>).blank === 'boolean'
          ? (metadata as Record<string, unknown>).blank as boolean
          : null
        return { title, blank }
      } catch {
        return { title: null, blank: null }
      }
    },
  }
}

/** 装配本插件需要的服务；persistence / registry / identity 为必需。 */
export function services(ctx: HostContext): Services {
  const persistence = ctx.get('sessionPersistence') as PersistenceLike | undefined
  const registry = ctx.get('workspaceRegistry') as RegistryLike | undefined
  const identity = ctx.get('workdshIdentity') as IdentityLike | undefined
  if (persistence === undefined || registry === undefined || identity === undefined) {
    throw new TransferError(ERR.unavailable, '会话服务尚未就绪，请稍后重试。')
  }
  return {
    persistence,
    registry,
    identity,
    audit: ctx.get('workdshAudit') as AuditLike | undefined,
    access: ctx.get('workdshAccess') as AccessLike | undefined,
    sessions: ctx.get('sessions') as SessionsLike | undefined,
    attachments: ctx.get('attachments') as AttachmentsLike | undefined,
    facts: sessionFactsReader(ctx),
  }
}

/** 登录前置；失败返回 401 语义。 */
export async function requireActor(identity: IdentityLike, signal?: AbortSignal): Promise<{
  principalId: string
  organizationId: string
  requestId: string
}> {
  try {
    return await identity.resolve(undefined, signal)
  } catch {
    throw new TransferError(ERR.unauthenticated, '请先完成登录。')
  }
}

// ---------------------------------------------------------------------------
// 官方 npm 包（动态加载，不静态 import 类型）
// ---------------------------------------------------------------------------

export interface CatalogLike {
  readonly currentVersion: number
  readHeader(headerValue: unknown): {
    readonly status: 'current' | 'migration-required' | 'unsupported' | 'malformed'
    readonly storedVersion?: number
    readonly targetVersion: number
    readonly header?: Record<string, unknown>
    readonly reason?: string
  }
  createRestore(headerValue: unknown, options: {
    recovery: 'strict' | 'recoverable'
    validation: 'transformed' | 'current'
  }): {
    readonly header: Record<string, unknown>
    decodeRow(rowValue: unknown): void
    finish(): {
      header: Record<string, unknown>
      inheritedEventCount: number
      events: readonly Record<string, unknown>[]
    }
  }
}

export interface LogExportLike {
  readSessionLogText(persistence: unknown, id: string, signal?: AbortSignal): Promise<string | undefined>
  serializeSessionLog(header: unknown, events: readonly unknown[]): string
  flushLiveSessionLog(deps: unknown, id: string, signal?: AbortSignal): Promise<void>
  sessionLogExportDeps(ctx: unknown): Record<string, unknown>
}

const CATALOG_SPECIFIER = '@deepseek-ai/dsh-session-format-catalog'
const LOG_EXPORT_SPECIFIER = '@deepseek-ai/dsh-session-log-export'

/** 加载官方格式目录；失败抛 transfer/unavailable。 */
export async function loadCatalog(): Promise<CatalogLike> {
  try {
    const mod = (await import(CATALOG_SPECIFIER)) as { sessionFormatCatalog?: CatalogLike }
    if (mod.sessionFormatCatalog === undefined) throw new Error('sessionFormatCatalog missing')
    return mod.sessionFormatCatalog
  } catch (error) {
    throw new TransferError(ERR.unavailable, `会话格式目录不可用：${messageOf(error)}`)
  }
}

/** 加载官方会话日志导出工具；这是公开 npm 包 exports。 */
export async function loadLogExport(): Promise<LogExportLike> {
  try {
    return (await import(LOG_EXPORT_SPECIFIER)) as unknown as LogExportLike
  } catch (error) {
    throw new TransferError(ERR.unavailable, `会话日志读取能力不可用：${messageOf(error)}`)
  }
}

/** 读取锁定 DSH 版本（仅写入 manifest 作来源记录）。 */
export function dshVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require('@deepseek-ai/dsh-session/package.json') as { version?: string }
    return manifest.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

/** 统一 JSON 响应（no-store）。 */
export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

export const failure = (status: number, code: string, message: string, details?: unknown): Response =>
  json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status)

/** 把任意异常转成可展示的 { status, code, message }。 */
export function toFailure(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof TransferError) {
    const status = error.code === ERR.unauthenticated ? 401
      : error.code === ERR.unavailable ? 503
      : error.code === ERR.invalidRequest ? 400
      : error.code === ERR.unsupportedSchema || error.code === ERR.versionUnsupported ? 422
      : 400
    return { status, code: error.code, message: error.message }
  }
  return { status: 500, code: ERR.failed, message: `操作失败：${messageOf(error)}` }
}

export function warn(ctx: HostContext, message: string): void {
  try {
    ctx.logger?.warn(message)
  } catch {
    // 日志失败不影响主流程。
  }
}
