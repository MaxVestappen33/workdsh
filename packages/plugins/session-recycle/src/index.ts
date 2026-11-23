import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  SESSION_ID,
  directoryBytes,
  locateSessionDirectories,
  rollbackDirectories,
  stageDirectories,
  subagentCascade,
  type SessionSnapshotLike,
  type StagedDirectory,
} from './delete.js'

/** 会话彻底删除：移出会话根目录 + 删除投影缓存，子智能体会话级联。 */
export const name = 'workdsh-plugin-session-recycle'
export const inject = ['connection']

const DELETE_PATH = '/api/workdsh-session-delete'
const NO_STORE = { 'cache-control': 'no-store' }

/** Host 侧只需要 connection 的注册面；其余服务用 ctx.get 按需读取，缺失时返回明确错误。 */
interface HostContext {
  connection: { fetch: { register(route: Record<string, unknown>): () => void } }
  effect(callback: () => () => void, label?: string): void
  provide(name: string, value: unknown): void
  get(service: string): unknown
  logger?: { warn(message: string): void }
}

interface PersistenceLike {
  stat(id: string, options?: { signal?: AbortSignal }): Promise<SessionSnapshotLike | undefined>
  list(options?: { signal?: AbortSignal }): Promise<readonly SessionSnapshotLike[]>
  open(id: string, access: 'read', options?: { signal?: AbortSignal }): Promise<{ header: SessionSnapshotLike['header']; close(): Promise<void> }>
}

interface RegistryLike {
  unarchiveSession(id: string): Promise<void>
  unpinSession(id: string): Promise<void>
}

interface IdentityLike {
  resolve(evidence?: unknown, signal?: AbortSignal): Promise<{ principalId: string; organizationId: string; requestId: string }>
  profile?: () => { organization?: { kind?: string } }
}

interface AuditLike {
  append(event: Record<string, unknown>): Promise<void>
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: NO_STORE })

const failure = (status: number, code: string, message: string): Response =>
  json({ error: { code, message } }, status)

/** 企业身份只用于给确认弹窗补一行审计提示，不做任何复杂流程。 */
function enterprise(identity: IdentityLike | undefined): boolean {
  try {
    const kind = identity?.profile?.().organization?.kind
    return kind !== undefined && kind !== 'personal'
  } catch {
    return false
  }
}

const warn = (ctx: HostContext, message: string): void => {
  try {
    ctx.logger?.warn(message)
  } catch {
    // 日志失败不影响删除结果。
  }
}

export function apply(context: Context): void {
  const ctx = context as unknown as HostContext
  ctx.provide('workdshSessionRecycle', Object.freeze({ path: DELETE_PATH }))
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: DELETE_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: (request: Request) => dispatch(ctx, request),
      }),
    'workdsh.session-recycle',
  )
}

/**
 * 统一兜底：路由内任何未预期异常都转成 JSON 错误。
 * 官方 `/api` 桥接层会把抛出的异常变成空 body 的 400，客户端只能显示“删除失败（HTTP 400）”，
 * 这里必须自己接住并给出可读原因。
 */
async function dispatch(ctx: HostContext, request: Request): Promise<Response> {
  try {
    return request.method === 'GET' ? await mode(ctx, request) : await remove(ctx, request)
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : String(error)
    console.error('[session-recycle] 删除会话失败:', error)
    warn(ctx, `会话删除异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    return failure(500, 'session/delete-failed', `删除会话失败：${detail}`)
  }
}

/** 确认弹窗打开时读取一次身份模式；个人模式不显示审计提示。 */
async function mode(ctx: HostContext, request: Request): Promise<Response> {
  const identity = ctx.get('workdshIdentity') as IdentityLike | undefined
  if (identity === undefined) return failure(503, 'session/unavailable', '身份服务尚未就绪，请稍后重试。')
  try {
    await identity.resolve(undefined, request.signal)
  } catch {
    return failure(401, 'session/unauthenticated', '请先完成登录。')
  }
  return json({ enterprise: enterprise(identity) })
}

async function remove(ctx: HostContext, request: Request): Promise<Response> {
  const identity = ctx.get('workdshIdentity') as IdentityLike | undefined
  const persistence = ctx.get('sessionPersistence') as PersistenceLike | undefined
  const sessions = ctx.get('sessions') as { get(id: string): unknown } | undefined
  const registry = ctx.get('workspaceRegistry') as RegistryLike | undefined
  const audit = ctx.get('workdshAudit') as AuditLike | undefined
  if (identity === undefined || persistence === undefined) {
    return failure(503, 'session/unavailable', '会话服务尚未就绪，请稍后重试。')
  }
  let actor: { principalId: string; organizationId: string; requestId: string }
  try {
    actor = await identity.resolve(undefined, request.signal)
  } catch {
    return failure(401, 'session/unauthenticated', '请先完成登录。')
  }

  let sessionId: unknown
  try {
    sessionId = ((await request.json()) as { sessionId?: unknown } | null)?.sessionId
  } catch {
    return failure(400, 'session/invalid-request', '请求格式不正确。')
  }
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    return failure(400, 'session/invalid-request', '会话编号不合法。')
  }

  const home = process.env.DSH_HOME?.trim()
  if (!home) return failure(500, 'session/no-home', '未找到 DSH_HOME，无法定位会话目录。')
  const root = join(home, 'sessions')

  let snapshot: SessionSnapshotLike | undefined
  try {
    snapshot = await persistence.stat(sessionId, { signal: request.signal })
  } catch {
    return failure(500, 'session/unreadable', '读取会话状态失败，请稍后重试。')
  }
  if (snapshot === undefined) return failure(404, 'session/not-found', '该会话不存在或已被删除。')
  if (sessions?.get(sessionId) !== undefined) {
    return failure(409, 'session/live', '该会话正在使用中，请先切换到其他会话再删除。')
  }

  let snapshots: readonly SessionSnapshotLike[]
  try {
    snapshots = await persistence.list({ signal: request.signal })
  } catch {
    return failure(500, 'session/unreadable', '读取会话列表失败，请稍后重试。')
  }
  const ids = subagentCascade(sessionId, snapshots)
  for (const id of ids.slice(1)) {
    if (sessions?.get(id) !== undefined) {
      return failure(409, 'session/live', '有子智能体会话正在使用中，请稍后重试。')
    }
  }

  const sources: Array<{ id: string; from: string }> = []
  for (const id of ids) {
    const directories = await locateSessionDirectories(root, id)
    if (directories.length > 1) {
      return failure(409, 'session/ambiguous', '会话的磁盘目录不唯一，已停止删除。')
    }
    if (directories.length === 0) {
      return failure(409, 'session/not-materialized', '会话尚未完整写入磁盘，请稍后重试。')
    }
    sources.push({ id, from: directories[0] })
  }

  // 移动前用官方 handle 校验目录里确实是这个会话，避免误删同名目录。
  for (const source of sources) {
    let handle
    try {
      handle = await persistence.open(source.id, 'read', { signal: request.signal })
    } catch {
      return failure(500, 'session/unreadable', '无法校验会话磁盘内容，已停止删除。')
    }
    try {
      if (handle?.header?.id !== source.id) {
        return failure(500, 'session/mismatch', '会话磁盘内容与编号不一致，已停止删除。')
      }
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  const staged: StagedDirectory[] = []
  const batch = join(home, '.workdsh-trash', `${Date.now()}-${randomUUID()}`)
  for (const source of sources) {
    staged.push({ ...source, to: join(batch, source.id), bytes: await directoryBytes(source.from) })
  }
  try {
    await stageDirectories(batch, staged)
  } catch (error) {
    warn(ctx, `会话删除：移入回收站失败（${error instanceof Error ? error.message : String(error)}）。`)
    return failure(500, 'session/delete-failed', '删除会话失败，已回滚，请稍后重试。')
  }

  // 会话服务必须已经看不到这些 id；否则整批移回，绝不留下半删状态。
  for (const id of ids) {
    let remaining: SessionSnapshotLike | undefined
    try {
      remaining = await persistence.stat(id, { signal: request.signal })
    } catch (error) {
      warn(ctx, `会话删除：校验可见性失败（${error instanceof Error ? error.message : String(error)}）。`)
      await rollbackDirectories(staged)
      await rm(batch, { recursive: true, force: true }).catch(() => undefined)
      return failure(500, 'session/delete-failed', '删除会话失败，已回滚，请稍后重试。')
    }
    if (remaining !== undefined) {
      await rollbackDirectories(staged)
      await rm(batch, { recursive: true, force: true }).catch(() => undefined)
      return failure(500, 'session/delete-failed', '会话仍被会话服务识别，已回滚删除。')
    }
  }

  for (const id of ids) {
    try {
      await registry?.unpinSession(id)
    } catch (error) {
      warn(ctx, `会话删除：解除置顶失败（${error instanceof Error ? error.message : String(error)}）。`)
    }
    try {
      await registry?.unarchiveSession(id)
    } catch (error) {
      warn(ctx, `会话删除：解除归档失败（${error instanceof Error ? error.message : String(error)}）。`)
    }
    await rm(join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`), { force: true }).catch((error) => {
      warn(ctx, `会话删除：删除投影缓存失败（${error instanceof Error ? error.message : String(error)}）。`)
    })
  }

  // 回收站只是回滚窗口，全部校验通过后立即永久删除。
  await rm(batch, { recursive: true, force: true }).catch((error) => {
    warn(ctx, `会话删除：清理回收站失败（${error instanceof Error ? error.message : String(error)}）。`)
  })

  const subagents = ids.slice(1)
  try {
    await audit?.append({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      requestId: actor.requestId,
      principalId: actor.principalId,
      organizationId: actor.organizationId,
      action: 'session.delete',
      target: { domain: 'session', id: sessionId },
      outcome: 'succeeded',
      code: 'session/deleted',
      references: { subagents: String(subagents.length) },
    })
  } catch (error) {
    warn(ctx, `会话删除：审计写入失败（${error instanceof Error ? error.message : String(error)}）。`)
  }

  return json({
    deleted: true,
    sessionId,
    subagents,
    bytes: staged.reduce((total, entry) => total + entry.bytes, 0),
    enterprise: enterprise(identity),
  })
}
