/**
 * 导出：preview 与 ZIP 流生成。
 *
 * 关键点：
 * - 导出前 flush 活动会话（服务级 flush + 官方 flushLiveSessionLog），否则
 *   最后几条事件（含触发导出的命令）不在包里。
 * - 会话日志走官方 readSessionLogText → 明文 JSONL（磁盘是 zstd，包内是
 *   解码后的 canonical JSONL），绝不直接读 DSH_HOME/sessions 下的 .zstd。
 * - 附件收集自研（官方收集函数未导出），保留完整 ref 供导入端重放。
 * - 工作区文件按口径 A 只带被引用的相对路径文件。
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { ZipEntry } from './zip.js'
import { zipStream, streamFile } from './zip.js'
import { ERR, TransferError } from './constants.js'
import type {
  AttachmentRefV2, ExportPreview, ExportRequest, JobPhase, SessionEntryV2,
  TransferManifestV2, WorkspaceEntryV2, WorkspaceFilesV2, WorkspaceFileEntryV2,
  WorkspaceFileSkipV2,
} from './types.js'
import type { HostContext, Services, CatalogLike, LogExportLike } from './host.js'
import { loadCatalog, loadLogExport, dshVersion, warn } from './host.js'
import { buildManifest } from './manifest.js'
import { attachmentMember, defaultWorkspaceRoot, exportFilename } from './paths.js'
import {
  collectAttachmentsFromLog, collectFileReferences, expandSelection, listSessions,
  validSessionIds, withinLimits,
} from './collect.js'
import { collectWorkspaceFiles, effectiveExcludes, verifyPlannedFile } from './workspace-files.js'
import type { AttachmentRef } from './collect.js'

export interface ExportContext {
  readonly ctx: HostContext
  readonly services: Services
  readonly catalog: CatalogLike
  readonly logExport: LogExportLike
  readonly actor: { principalId: string; organizationId: string; requestId: string }
  readonly home: string
}

interface PreparedExport {
  readonly manifest: TransferManifestV2
  /** sessionId → 明文 JSONL */
  readonly logs: ReadonlyMap<string, string>
  /** 附件 ref → 本机绝对路径 */
  readonly attachmentPaths: ReadonlyMap<string, string>
  /** 工作区文件 → 本机绝对路径 */
  readonly filePaths: ReadonlyMap<string, string>
  readonly filename: string
}

/** 准备导出内容（preview 与实际导出共用，保证两者统计一致）。 */
export async function prepareExport(context: ExportContext, request: ExportRequest): Promise<PreparedExport> {
  const { services, catalog, logExport } = context
  const sessionIds = validSessionIds(request.sessionIds)
  if (sessionIds.length === 0) {
    throw new TransferError(ERR.invalidRequest, '请选择至少一个会话。')
  }

  const snapshots = await services.persistence.list()
  const selected = expandSelection(sessionIds, snapshots)
  const byId = new Map(snapshots.map((s) => [s.header.id, s]))

  // 运行中会话禁止导出
  for (const id of selected) {
    const live = services.sessions?.get(id)
    if (isRunningSession(live)) {
      throw new TransferError(ERR.runningSession, `会话 ${id} 正在运行中，请等待结束后再导出。`)
    }
  }

  // 【必须】flush：先逐会话 flushLiveSessionLog，再服务级 flush barrier
  const deps = logExport.sessionLogExportDeps(context.ctx)
  for (const id of selected) {
    try {
      await logExport.flushLiveSessionLog(deps, id)
    } catch (error) {
      warn(context.ctx, `会话迁移导出：flush ${id} 失败（${String(error)}）。`)
    }
  }
  await services.persistence.flush().catch((error) => {
    warn(context.ctx, `会话迁移导出：flush barrier 失败（${String(error)}）。`)
  })

  // 逐会话读取明文 JSONL
  const logs = new Map<string, string>()
  for (const id of selected) {
    const text = await logExport.readSessionLogText(services.persistence, id)
    if (text === undefined) continue
    logs.set(id, text)
  }

  // 工作区清单
  const workspaces: WorkspaceEntryV2[] = (services.registry.list() ?? []).map((ws) => ({
    id: ws.id,
    title: ws.title,
    path: ws.path,
  }))
  const roots = new Map(workspaces.map((ws) => [ws.id, ws.path]))

  // 附件引用
  const attachmentRefs = new Map<string, AttachmentRef>()
  for (const text of logs.values()) {
    for (const [id, ref] of collectAttachmentsFromLog(text)) {
      const existing = attachmentRefs.get(id)
      if (existing === undefined) attachmentRefs.set(id, ref)
    }
  }

  // 工作区文件引用（口径 A）：按勾选的工作区过滤，缺省 fileWorkspaceIds = 全部工作区
  const fileScope = request.includeWorkspaceFiles
    ? (request.fileWorkspaceIds === undefined ? undefined : new Set(request.fileWorkspaceIds))
    : new Set<string>()
  const includeFiles = request.includeWorkspaceFiles && (fileScope === undefined || fileScope.size > 0)
  const fileRefs = includeFiles
    ? [...logs.values()]
      .flatMap((text) => collectFileReferences(text, workspaces).references)
      .filter((ref) => fileScope === undefined || fileScope.has(ref.workspaceId))
    : []
  const filePlan = includeFiles
    ? await collectWorkspaceFiles(fileRefs, roots, request.userExcludes ?? [])
    : { files: [], skipped: [], totals: { fileCount: 0, byteLength: 0 }, exceeds: [] }

  // 会话条目
  const archivedIds = new Set(services.registry.archivedSessionIds ?? [])
  const sessionEntries: Omit<SessionEntryV2, 'logName'>[] = []
  for (const id of selected) {
    const snapshot = byId.get(id)
    if (snapshot === undefined || !logs.has(id)) continue
    const header = snapshot.header
    const workspaceId = workspaceIdFor(header.cwd, workspaces)
    const text = logs.get(id) ?? ''
    sessionEntries.push({
      id,
      title: titleFromLog(text, id),
      workspaceId,
      version: header.version,
      createdAt: header.createdAt,
      ...(header.cwd !== undefined ? { cwd: header.cwd } : {}),
      ...(header.parentSession !== undefined ? { parentSession: header.parentSession } : {}),
      ...(header.origin !== undefined ? { origin: header.origin } : {}),
      ...(header.delegationDepth !== undefined ? { delegationDepth: header.delegationDepth } : {}),
      ...(header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {}),
      eventCount: countEvents(text),
      sizeBytes: snapshot.sizeBytes,
      archived: archivedIds.has(id),
      attachments: [...collectAttachmentsFromLog(text).keys()],
    })
  }

  // 附件成员：解析 sha 并定位本机文件
  const attachmentEntries: AttachmentRefV2[] = []
  const attachmentPaths = new Map<string, string>()
  const missingAttachments: string[] = []
  for (const [id, ref] of attachmentRefs) {
    const match = /^sha256:([a-f0-9]{64})$/u.exec(id)
    if (match === null) {
      missingAttachments.push(id)
      continue
    }
    const digest = match[1]
    const candidate = attachmentHostPath(context, ref, digest)
    if (candidate === undefined) {
      missingAttachments.push(id)
      continue
    }
    const info = await stat(candidate).catch(() => undefined)
    if (info === undefined || !info.isFile()) {
      missingAttachments.push(id)
      continue
    }
    attachmentPaths.set(id, candidate)
    attachmentEntries.push({
      id,
      kind: ref.kind,
      ...(ref.name !== undefined ? { name: ref.name } : {}),
      ...(ref.mediaType !== undefined ? { mediaType: ref.mediaType } : {}),
      bytes: info.size,
      ...(ref.width !== undefined ? { width: ref.width } : {}),
      ...(ref.height !== undefined ? { height: ref.height } : {}),
      member: attachmentMember(id, ref.kind),
    })
  }

  // 工作区文件清单（manifest 只记相对路径与摘要，不含本机绝对路径）
  const skipped: readonly WorkspaceFileSkipV2[] = filePlan.skipped
  const workspaceFiles: WorkspaceFilesV2 = {
    included: includeFiles,
    policy: 'referenced-relative-only',
    excludes: [...effectiveExcludes(request.userExcludes ?? []).recorded],
    userExcludes: [...(request.userExcludes ?? [])],
    files: filePlan.files.map((f) => ({
      workspaceId: f.workspaceId,
      path: f.path,
      sha256: f.sha256,
      bytes: f.bytes,
      ...(f.executable ? { executable: true } : {}),
    })),
    skipped,
    totals: filePlan.totals,
  }

  const filePaths = new Map<string, string>()
  for (const file of filePlan.files) {
    filePaths.set(`workspace/${file.workspaceId}/${file.path}`, file.absolute)
  }

  const manifest = buildManifest({
    exportedAt: new Date().toISOString(),
    client: {
      appVersion: process.env.WORKDSH_APP_VERSION ?? null,
      dshVersion: dshVersion(),
      device: process.env.WORKDSH_DEVICE_ID ?? null,
      platform: process.platform,
    },
    sessionVersion: catalog.currentVersion,
    workspaces,
    sessions: sessionEntries,
    attachments: attachmentEntries,
    missingAttachments,
    workspaceFiles,
    archivePolicy: request.archivePolicy ?? 'preserve',
  })

  return { manifest, logs, attachmentPaths, filePaths, filename: exportFilename(new Date()) }
}

/**
 * 导出选择页的轻量列举：只列会话与工作区分组，不 flush、不读日志、不收集附件。
 * 前端用 `POST export.preview {}`（空 sessionIds）调用，避免打开弹窗就触发重活。
 */
export async function exportList(context: ExportContext): Promise<ExportPreview> {
  const snapshots = await context.services.persistence.list()
  const { groups } = await listSessions(snapshots, context.services, (id) => readLogTitle(context, id))
  const sessions = groups.flatMap((group) => group.sessions)
  return {
    sessions,
    groups,
    attachments: { count: 0, bytes: 0 },
    workspaceFiles: { fileCount: 0, byteLength: 0, skipped: 0 },
    totals: { sessionCount: sessions.length, byteLength: 0 },
    exceeds: [],
  }
}

/** 投影缺标题时回退读日志（例如刚导入、尚未被官方折叠过的会话）。 */
async function readLogTitle(context: ExportContext, sessionId: string): Promise<string | null> {
  const text = await context.logExport.readSessionLogText(context.services.persistence, sessionId)
  if (text === undefined) return null
  const title = titleFromLog(text, '')
  return title === '' ? null : title
}

/** preview：给前端展示统计与超限提示，不生成 ZIP。 */
export async function exportPreview(context: ExportContext, request: ExportRequest): Promise<ExportPreview> {
  const prepared = await prepareExport(context, request)
  const { manifest } = prepared
  const snapshots = await context.services.persistence.list()
  const { groups } = await listSessions(snapshots, context.services, (id) => readLogTitle(context, id))
  const selectedIds = new Set(manifest.sessions.map((s) => s.id))
  const attachmentsBytes = manifest.attachments.reduce((total, a) => total + a.bytes, 0)
  const logsBytes = [...prepared.logs.values()].reduce((total, text) => total + Buffer.byteLength(text), 0)

  const exceeds: string[] = []
  const limits = withinLimits(manifest.workspaceFiles.totals.fileCount, manifest.workspaceFiles.totals.byteLength)
  exceeds.push(...limits.reasons)

  return {
    sessions: groups.flatMap((g) => g.sessions).filter((s) => selectedIds.has(s.id)),
    groups: groups.map((g) => ({ ...g, sessions: g.sessions.filter((s) => selectedIds.has(s.id)) })),
    attachments: { count: manifest.attachments.length, bytes: attachmentsBytes },
    workspaceFiles: {
      fileCount: manifest.workspaceFiles.totals.fileCount,
      byteLength: manifest.workspaceFiles.totals.byteLength,
      skipped: manifest.workspaceFiles.skipped.length,
    },
    totals: { sessionCount: manifest.sessions.length, byteLength: logsBytes + attachmentsBytes + manifest.workspaceFiles.totals.byteLength },
    exceeds,
  }
}

export interface ExportProgress {
  readonly phase: JobPhase
  readonly done: number
  readonly total: number
  readonly current: string
}

/** 实际导出：返回 ZIP 流 + 文件名；onProgress 在每个条目产出时回调（拉式驱动，进度真实）。 */
export async function exportArchive(
  context: ExportContext,
  request: ExportRequest,
  signal?: AbortSignal,
  onProgress?: (info: ExportProgress) => void,
): Promise<{
  stream: ReadableStream<Uint8Array>
  filename: string
  manifest: TransferManifestV2
  /** 流被完整消费后调用，返回与实际 ZIP 内容一致的最终 manifest（含二次校验跳过的文件）。 */
  readManifest(): TransferManifestV2
}> {
  const prepared = await prepareExport(context, request)
  const { manifest, logs, attachmentPaths, filePaths } = prepared
  const catalog = context.catalog

  const total = manifest.sessions.length + manifest.attachments.length
    + (manifest.workspaceFiles.included ? manifest.workspaceFiles.files.length : 0) + 1
  let done = 0
  const tick = (phase: JobPhase, current: string): void => {
    done += 1
    onProgress?.({ phase, done, total, current })
  }

  // 二次校验失败的文件不会产出成员，必须同步从 manifest 里移除，
  // 否则导入端 crossCheckMembers 会因「包内缺少工作区文件」整包拒绝。
  const effectiveFiles: WorkspaceFileEntryV2[] = []
  const extraSkipped: WorkspaceFileSkipV2[] = []
  const finalManifest = (): TransferManifestV2 => manifest.workspaceFiles.included
    ? {
      ...manifest,
      workspaceFiles: {
        ...manifest.workspaceFiles,
        files: effectiveFiles,
        skipped: [...manifest.workspaceFiles.skipped, ...extraSkipped],
        totals: {
          fileCount: effectiveFiles.length,
          byteLength: effectiveFiles.reduce((sum, file) => sum + file.bytes, 0),
        },
      },
    }
    : manifest

  const entries = (async function* (): AsyncGenerator<ZipEntry> {
    // 会话日志
    for (const session of manifest.sessions) {
      signal?.throwIfAborted()
      const text = logs.get(session.id)
      if (text !== undefined) {
        tick('logs', `写入会话日志 ${done + 1}/${total}`)
        yield { path: session.logName, content: text }
      }
    }
    // 附件
    for (const attachment of manifest.attachments) {
      signal?.throwIfAborted()
      const path = attachmentPaths.get(attachment.id)
      if (path === undefined) continue
      tick('attachments', `打包附件 ${done + 1}/${total}`)
      yield { path: attachment.member, chunks: streamFile(path) }
    }
    // 工作区文件：写前二次校验，变化则跳过，不产出半成品
    if (manifest.workspaceFiles.included) {
      for (const file of manifest.workspaceFiles.files) {
        signal?.throwIfAborted()
        const member = `workspace/${file.workspaceId}/${file.path}`
        const path = filePaths.get(member)
        if (path === undefined) continue
        const planEntry = {
          workspaceId: file.workspaceId, path: file.path, sha256: file.sha256,
          bytes: file.bytes, absolute: path,
        }
        if (!(await verifyPlannedFile(planEntry))) {
          extraSkipped.push({ path: file.path, reason: 'changed-during-export' })
          continue
        }
        effectiveFiles.push(file)
        tick('workspace-files', `打包源文件 ${done + 1}/${total}`)
        yield { path: member, chunks: streamFile(path) }
      }
    }
    // manifest 最后写（导入端可据此确认完整性）：必须与实际产出的成员一致。
    tick('done', '写入清单')
    yield { path: 'manifest.json', content: JSON.stringify(finalManifest(), null, 2) }
  })()

  return {
    stream: zipStream(entries, { signal }),
    filename: prepared.filename,
    manifest: { ...manifest, format: { ...manifest.format, sessionVersion: catalog.currentVersion } },
    readManifest: () => {
      const final = finalManifest()
      return { ...final, format: { ...final.format, sessionVersion: catalog.currentVersion } }
    },
  }
}

/** 导出审计（references 值必须是 string，且避开敏感 key）。 */
export async function writeExportAudit(context: ExportContext, manifest: TransferManifestV2): Promise<void> {
  try {
    await context.services.audit?.append({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      requestId: context.actor.requestId,
      principalId: context.actor.principalId,
      organizationId: context.actor.organizationId,
      action: 'session.transfer.export',
      outcome: 'succeeded',
      code: 'session/transfer-exported',
      references: {
        sessionCount: String(manifest.sessions.length),
        fileCount: String(manifest.workspaceFiles.totals.fileCount),
        fileBytes: String(manifest.workspaceFiles.totals.byteLength),
        attachmentCount: String(manifest.attachments.length),
        filesIncluded: String(manifest.workspaceFiles.included),
        sessionVersion: String(manifest.format.sessionVersion),
        packageDigest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 32),
      },
    })
  } catch (error) {
    warn(context.ctx, `会话迁移导出审计写入失败：${String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isRunningSession(live: unknown): boolean {
  if (typeof live !== 'object' || live === null) return false
  return (live as Record<string, unknown>).status === 'running'
}

function workspaceIdFor(cwd: string | undefined, workspaces: readonly WorkspaceEntryV2[]): string {
  if (cwd === undefined) return ''
  const normalized = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase()
  return workspaces.find((ws) => ws.path.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase() === normalized)?.id ?? ''
}

function titleFromLog(text: string, fallback: string): string {
  let title = fallback
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      const row = JSON.parse(line) as Record<string, unknown>
      if (row.type !== 'session/title') continue
      const data = row.data
      if (typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).title === 'string') {
        title = (data as Record<string, unknown>).title as string
      }
    } catch {
      continue
    }
  }
  return title
}

function countEvents(text: string): number {
  let count = 0
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      const row = JSON.parse(line) as Record<string, unknown>
      if (row.type !== 'session') count += 1
    } catch {
      // 忽略坏行
    }
  }
  return count
}

/** 从官方 attachments 服务解析本机路径；拿不到时按 DSH_HOME 内容寻址布局兜底。 */
function attachmentHostPath(context: ExportContext, ref: AttachmentRef, digest: string): string | undefined {
  const attachments = context.services.attachments
  if (attachments !== undefined) {
    const input: Record<string, unknown> = { attachmentId: ref.id }
    if (ref.mediaType !== undefined) input.mediaType = ref.mediaType
    if (ref.bytes !== undefined) input.bytes = ref.bytes
    if (ref.width !== undefined) input.width = ref.width
    if (ref.height !== undefined) input.height = ref.height
    if (ref.name !== undefined) input.name = ref.name
    const path = ref.kind === 'image'
      ? attachments.imageHostPath(input as never)
      : attachments.fileHostPath(input as never)
    if (path !== undefined) return path
  }
  // 兜底：官方 dsh-attachment-local 的公开磁盘布局（DSH_HOME/attachments/v1）
  const bucket = ref.kind === 'image' ? 'objects' : 'file-objects'
  return `${context.home}/attachments/v1/${bucket}/${digest.slice(0, 2)}/${digest}`
}

/** 供 UI 生成新建目录默认路径。 */
export { defaultWorkspaceRoot }
