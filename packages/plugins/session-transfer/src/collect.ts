/**
 * 会话枚举、分组、子会话级联、事件引用收集。
 *
 * 附件引用收集参考官方 dsh-session-log-export 的 collectEventAttachmentRefs
 * 事件类型清单（该函数未导出，故在此实现等价逻辑，见 README「实现契约」）。
 * 工作区文件引用为插件自研：只提取可解析为工作区根内相对路径的项。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ATTACHMENT_ID, LIMITS, SESSION_ID, UNASSIGNED_WORKSPACE_ID, UNASSIGNED_WORKSPACE_TITLE } from './constants.js'
import type { SessionItem, WorkspaceGroup } from './types.js'
import type { SessionHeaderLike, SessionSnapshotLike, Services } from './host.js'
import { normalizeRelative, relativeToWorkspace } from './paths.js'

export interface AttachmentRef {
  readonly id: string
  readonly kind: 'image' | 'file'
  readonly name?: string
  readonly mediaType?: string
  readonly bytes?: number
  readonly width?: number
  readonly height?: number
}

/** 官方收集器覆盖的事件类型（含 carrier.stream 的 block-end 块）。 */
const CONTENT_EVENT_TYPES = new Set([
  'user/message',
  'tool/ptc-dispatch',
  'system/message',
  'developer/message',
  'tool/result',
  'team/message/queued',
  'agent/inbox/spliced',
  'compaction/summary',
  'assistant/message',
  'assistant/attempt',
])

interface ContentBlock {
  type?: string
  attachment?: Record<string, unknown>
}

/** 从一个 content 数组里收集 image / file 块的完整附件 ref。 */
function collectFromContent(content: unknown, out: Map<string, AttachmentRef>): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const item = block as ContentBlock
    if (item.type !== 'image' && item.type !== 'file') continue
    const attachment = item.attachment
    if (typeof attachment !== 'object' || attachment === null) continue
    const id = attachment.attachmentId
    if (typeof id !== 'string' || !ATTACHMENT_ID.test(id)) continue
    const kind = item.type === 'image' ? 'image' : 'file'
    const ref: AttachmentRef = {
      id,
      kind,
      ...(typeof attachment.name === 'string' ? { name: attachment.name } : {}),
      ...(typeof attachment.mediaType === 'string' ? { mediaType: attachment.mediaType } : {}),
      ...(typeof attachment.bytes === 'number' ? { bytes: attachment.bytes } : {}),
      ...(typeof attachment.width === 'number' ? { width: attachment.width } : {}),
      ...(typeof attachment.height === 'number' ? { height: attachment.height } : {}),
    }
    // 同一 id 可能被多处引用；优先保留信息更完整的那份。
    const existing = out.get(id)
    if (existing === undefined || score(ref) > score(existing)) out.set(id, ref)
  }
}

function score(ref: AttachmentRef): number {
  return [ref.name, ref.mediaType, ref.bytes, ref.width, ref.height].filter((v) => v !== undefined).length
}

/** 取一个事件里可能承载 content 的字段。 */
function eventContent(event: Record<string, unknown>): unknown {
  const data = event.data
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>
    if (Array.isArray(record.content)) return record.content
    if (Array.isArray(record.blocks)) return record.blocks
    const message = record.message
    if (typeof message === 'object' && message !== null) {
      const m = message as Record<string, unknown>
      if (Array.isArray(m.content)) return m.content
    }
  }
  if (Array.isArray(event.content)) return event.content
  return undefined
}

/** 从一条事件收集附件引用。 */
export function collectEventAttachments(event: Record<string, unknown>, out: Map<string, AttachmentRef>): void {
  const type = typeof event.type === 'string' ? event.type : ''
  if (CONTENT_EVENT_TYPES.has(type)) {
    collectFromContent(eventContent(event), out)
  }
  // carrier.stream 的已完成流块
  if (type === 'carrier.stream') {
    const data = event.data
    if (typeof data === 'object' && data !== null) {
      const chunk = (data as Record<string, unknown>).chunk
      if (typeof chunk === 'object' && chunk !== null) {
        const c = chunk as Record<string, unknown>
        if (c.type === 'block-end') {
          collectFromContent(c.content ?? c.block, out)
        }
      }
    }
  }
}

/** 从一段明文 JSONL 收集全部附件引用。 */
export function collectAttachmentsFromLog(text: string): Map<string, AttachmentRef> {
  const out = new Map<string, AttachmentRef>()
  for (const line of text.split('\n')) {
    if (line === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof row !== 'object' || row === null) continue
    if ((row as Record<string, unknown>).type === 'session') continue
    collectEventAttachments(row as Record<string, unknown>, out)
  }
  return out
}

// ---------------------------------------------------------------------------
// 工作区文件引用
// ---------------------------------------------------------------------------

/** 可能含路径的事件/字段。 */
function* candidateStrings(event: Record<string, unknown>): Generator<string> {
  const type = typeof event.type === 'string' ? event.type : ''
  const data = event.data
  if (typeof data !== 'object' || data === null) return
  const record = data as Record<string, unknown>

  // @ 文件引用会出现在用户消息文本里
  if (type === 'user/message') {
    for (const value of textValues(record.content)) yield value
  }
  // tool/call 的 arguments 是模型产出的原始 JSON 字符串，里面含 path
  if (type === 'tool/call' || type === 'tool/result') {
    for (const key of ['arguments', 'args', 'input', 'result', 'output', 'path', 'filePath']) {
      const value = record[key]
      if (typeof value === 'string') yield value
      else if (typeof value === 'object' && value !== null) {
        for (const nested of stringValues(value)) yield nested
      }
    }
    // 官方事件把工具输出放在 data.message.content[].text（例如 "saved: xxx.docx"、
    // "Presented /abs/path/xxx.docx"），这里也要覆盖，否则产物路径完全取不到。
    const message = record.message
    if (typeof message === 'object' && message !== null) {
      for (const value of textValues((message as Record<string, unknown>).content)) yield value
    }
    for (const value of textValues(record.content)) yield value
  }
  // dsh-resource:// 地址
  for (const value of stringValues(record)) {
    if (value.startsWith('dsh-resource://')) yield value
  }
}

function* textValues(content: unknown): Generator<string> {
  if (typeof content === 'string') {
    yield content
    return
  }
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (typeof block === 'string') {
      yield block
    } else if (typeof block === 'object' && block !== null) {
      const record = block as Record<string, unknown>
      if (typeof record.text === 'string') yield record.text
      if (typeof record.path === 'string') yield record.path
    }
  }
}

function* stringValues(value: unknown): Generator<string> {
  if (typeof value === 'string') {
    yield value
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* stringValues(item)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value as Record<string, unknown>)) yield* stringValues(nested)
  }
}

/** 从字符串里抽取看起来像路径的 token。 */
const PATH_TOKEN = /(?:[A-Za-z]:\\[^\s"'<>|]+|\/(?:[^\s"'<>|\/]+\/)*[^\s"'<>|]+|[\w.-]+(?:[\/\\][\w.-]+)+)/gu

export interface FileReference {
  /** 原始字符串（用于 skipped 报告） */
  readonly raw: string
  /** 解析出的工作区相对路径；无法解析则为 undefined */
  readonly relative?: string
  readonly workspaceId: string
}

/**
 * 从明文 JSONL 提取「位于工作区内」的相对路径引用。
 * 只保留相对路径或能映射到 workspace root 的绝对路径；其它记入 skipped。
 */
export function collectFileReferences(
  text: string,
  workspaces: readonly { id: string; path: string }[],
): { references: FileReference[]; skipped: string[] } {
  const references: FileReference[] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    if (line === '') continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof row !== 'object' || row === null) continue
    const event = row as Record<string, unknown>
    if (event.type === 'session') continue
    for (const value of candidateStrings(event)) {
      // 1) 常规 token：相对路径、以及不含空格/非 ASCII 的绝对路径
      for (const token of value.match(PATH_TOKEN) ?? []) {
        const cleaned = cleanToken(token)
        if (cleaned === '' || cleaned.length > 512) continue
        const found = resolveReference(cleaned, workspaces)
        if (found === undefined) {
          if (!seen.has('skip:' + cleaned)) {
            seen.add('skip:' + cleaned)
            skipped.push(cleaned)
          }
          continue
        }
        const key = found.workspaceId + ':' + found.relative
        if (seen.has(key)) continue
        seen.add(key)
        references.push({ raw: cleaned, relative: found.relative, workspaceId: found.workspaceId })
      }
      // 2) 路径里带空格/非 ASCII 时 token 会被拆碎（macOS 默认工作区就是
      //    ".../Application Support/..."）：直接按工作区根前缀定位，再取磁盘上
      //    真实存在的最长相对路径。
      for (const ws of workspaces) {
        if (value.indexOf(ws.path) === -1) continue
        for (const hit of pathCandidatesAfterRoot(value, ws.path)) {
          const key = ws.id + ':' + hit
          if (seen.has(key)) continue
          seen.add(key)
          references.push({ raw: ws.path + '/' + hit, relative: hit, workspaceId: ws.id })
        }
      }
    }
  }
  return { references, skipped }
}

function cleanToken(token: string): string {
  return token.replace(/^['"`]+|['"`]+$/gu, '').replace(/[.,;:!?]+$/gu, '')
}

/** 字符串里每个工作区根之后、磁盘上存在的相对路径（每个位置取最长可存在的那个）。 */
function pathCandidatesAfterRoot(value: string, root: string): string[] {
  const found: string[] = []
  let from = 0
  while (true) {
    const at = value.indexOf(root, from)
    if (at === -1) return found
    from = at + root.length
    const rest = value.slice(from)
    const stop = rest.search(/["'`<>|\r\n\t，。；：、！？（）【】「」『』]/u)
    const segment = (stop === -1 ? rest : rest.slice(0, stop)).replace(/^\/+/u, '')
    if (segment === '') continue
    // 只在空白边界尝试，最长优先
    const bounds: number[] = []
    for (let i = 1; i <= segment.length && bounds.length < 8; i += 1) {
      if (i === segment.length || /\s/u.test(segment[i - 1] ?? '')) bounds.push(i)
    }
    for (const end of bounds.reverse()) {
      const slice = segment.slice(0, end).trimEnd()
      const relative = normalizeRelative(slice)
      if (relative === undefined) continue
      if (existsSync(join(root, relative))) {
        found.push(relative)
        break
      }
    }
  }
}

function resolveReference(
  token: string,
  workspaces: readonly { id: string; path: string }[],
): { workspaceId: string; relative: string } | undefined {
  // dsh-resource://file/session/... 之类地址：取路径部分
  let candidate = token
  if (candidate.startsWith('dsh-resource://')) {
    candidate = candidate.replace(/^dsh-resource:\/\/[^/]*\/?/u, '')
  }
  // 绝对路径：必须落在某个工作区根内
  if (/^[A-Za-z]:\\/u.test(candidate) || candidate.startsWith('/')) {
    for (const ws of workspaces) {
      const relative = relativeToWorkspace(candidate, ws.path)
      if (relative !== undefined) return { workspaceId: ws.id, relative }
    }
    return undefined
  }
  // 相对路径：单工作区时归到它；多工作区时无法判定归属，跳过
  const relative = normalizeRelative(candidate)
  if (relative === undefined) return undefined
  if (workspaces.length === 1) return { workspaceId: workspaces[0].id, relative }
  return undefined
}

// ---------------------------------------------------------------------------
// 会话分组与级联
// ---------------------------------------------------------------------------

/** 根会话 + 其 origin==='subagent' 且有 parentSession 的后代；分叉不级联。 */
export function subagentCascade(rootId: string, snapshots: readonly SessionSnapshotLike[]): string[] {
  const children = new Map<string, SessionHeaderLike[]>()
  for (const snapshot of snapshots) {
    const parent = snapshot.header.parentSession
    if (parent === undefined) continue
    const list = children.get(parent)
    if (list === undefined) children.set(parent, [snapshot.header])
    else list.push(snapshot.header)
  }
  const result = [rootId]
  const seen = new Set(result)
  for (let index = 0; index < result.length; index += 1) {
    for (const child of children.get(result[index]) ?? []) {
      if (child.origin !== 'subagent' || seen.has(child.id)) continue
      seen.add(child.id)
      result.push(child.id)
    }
  }
  return result
}

/** 把用户勾选补齐为「根 + 后代同组」的 id 集合（拓扑序：父在子前）。 */
export function expandSelection(selected: readonly string[], snapshots: readonly SessionSnapshotLike[]): string[] {
  const byId = new Map(snapshots.map((s) => [s.header.id, s]))
  const ordered: string[] = []
  const seen = new Set<string>()
  const visit = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    const snapshot = byId.get(id)
    const parent = snapshot?.header.parentSession
    if (parent !== undefined && byId.has(parent)) visit(parent)
    ordered.push(id)
  }
  for (const id of selected) {
    if (!byId.has(id)) continue
    for (const member of subagentCascade(id, snapshots)) visit(member)
  }
  return ordered
}

export interface ListedSession {
  readonly snapshot: SessionSnapshotLike
  readonly running: boolean
  readonly opened: boolean
  readonly subs: number
  readonly archived: boolean
  /** 创建后从未开始 turn 的空会话（侧栏同样不显示） */
  readonly blank: boolean
  /** 投影标题；缺失时为 null */
  readonly title: string | null
}

/**
 * 列举会话（含归档），标注 running/opened。
 * 标题与空会话标记来自官方投影；投影缺失时（例如刚导入、还没被官方折叠过）可用
 * resolveTitle 回退读取日志标题；仍拿不到才以会话 id 兜底。
 * 子代理会话与空会话不进入列表：前者随父会话自动级联导出，后者没有可迁移内容。
 */
export async function listSessions(
  snapshots: readonly SessionSnapshotLike[],
  services: Services,
  resolveTitle?: (sessionId: string) => Promise<string | null>,
): Promise<{ listed: ListedSession[]; groups: WorkspaceGroup[]; items: SessionItem[] }> {
  const archivedIds = new Set(services.registry.archivedSessionIds ?? [])
  const workspaces = services.registry.list() ?? []
  const wsByPath = new Map(workspaces.map((ws) => [normalizePathKey(ws.path), ws]))
  const childCount = new Map<string, number>()
  for (const snapshot of snapshots) {
    const parent = snapshot.header.parentSession
    if (parent !== undefined && snapshot.header.origin === 'subagent') {
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
    }
  }

  const listed: ListedSession[] = snapshots.map((snapshot) => {
    const live = services.sessions?.get(snapshot.header.id)
    const facts = services.facts.read(snapshot.header, live)
    return {
      snapshot,
      running: isRunning(live),
      opened: live !== undefined && live !== null,
      subs: childCount.get(snapshot.header.id) ?? 0,
      archived: archivedIds.has(snapshot.header.id),
      blank: facts.blank === true,
      title: facts.title,
    }
  })

  // 只为进入列表且缺标题的会话补标题，避免为全量会话读日志
  const visible = listed.filter((entry) => entry.snapshot.header.origin !== 'subagent' && !entry.blank)
  const fallbackTitles = new Map<string, string>()
  if (resolveTitle !== undefined) {
    for (const entry of visible) {
      if (entry.title !== null) continue
      try {
        const title = await resolveTitle(entry.snapshot.header.id)
        if (title !== null && title.trim() !== '') fallbackTitles.set(entry.snapshot.header.id, title.trim())
      } catch {
        // 读日志失败不影响列表
      }
    }
  }

  const items: SessionItem[] = visible
    .map((entry) => {
      const header = entry.snapshot.header
      const ws = header.cwd !== undefined ? wsByPath.get(normalizePathKey(header.cwd)) : undefined
      return {
        id: header.id,
        title: entry.title ?? fallbackTitles.get(header.id) ?? titleOf(header),
        workspaceId: ws?.id ?? '',
        sizeBytes: entry.snapshot.sizeBytes ?? 0,
        at: new Date(header.createdAt || Date.now()).toISOString(),
        archived: entry.archived,
        running: entry.running,
        opened: entry.opened,
        subs: entry.subs,
        ...(header.parentSession !== undefined ? { parentSession: header.parentSession } : {}),
        ...(entry.snapshot.eventCount !== undefined ? { eventCount: entry.snapshot.eventCount } : {}),
      }
    })

  const groups: WorkspaceGroup[] = workspaces.map((ws) => ({
    id: ws.id,
    title: ws.title,
    path: ws.path,
    sessions: items.filter((item) => item.workspaceId === ws.id),
  }))
  // 未匹配到工作区的会话归入一个虚拟组，避免列表里消失
  const orphans = items.filter((item) => item.workspaceId === '')
  if (orphans.length > 0) {
    groups.push({ id: UNASSIGNED_WORKSPACE_ID, title: UNASSIGNED_WORKSPACE_TITLE, path: '', sessions: orphans })
  }
  return { listed, groups, items }
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()
}

function isRunning(live: unknown): boolean {
  if (typeof live !== 'object' || live === null) return false
  const status = (live as Record<string, unknown>).status
  return status === 'running'
}

function titleOf(header: SessionHeaderLike): string {
  // 标题优先取官方 title 投影；投影缺失（或标题尚未生成）时用会话 id 兜底。
  return header.id
}

/** 校验会话 id 集合。 */
export function validSessionIds(ids: readonly unknown[]): string[] {
  return ids.filter((id): id is string => typeof id === 'string' && SESSION_ID.test(id))
}

/** 阈值检查：源文件总数与层级。 */
export function withinLimits(fileCount: number, totalBytes: number): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (fileCount > LIMITS.maxFileCount) reasons.push(`文件数超过 ${LIMITS.maxFileCount}`)
  if (totalBytes > LIMITS.maxSourceBytes) reasons.push(`源文件总计超过 ${LIMITS.maxSourceBytes} 字节`)
  return { ok: reasons.length === 0, reasons }
}
