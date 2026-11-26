/**
 * 导入：preview（解包校验）与 apply（批次事务）。
 *
 * 版本策略（最终决策）：只接受 v ≤ 当前版本。readHeader 返回 unsupported
 * （包版本高于本机）或 malformed 时整包拒绝并提示升级客户端；migration-required
 * 时复用官方 catalog 的相邻迁移链升到 currentVersion。
 *
 * 冲突策略（定稿）：勾选 = 导入为新会话；不勾选 = 跳过。本地已存在同 ID 的
 * 会话在 apply 时统一生成新 ID，并同步改写父子关系与事件里的结构化 id 引用，
 * 标题追加「（导入）」[P10]。根 + 子作为一组重映射，不出现半组状态。
 *
 * 事务语义：失败 = 单会话隔离；取消 = 全批次回滚。bindSession 只在全部会话
 * 成功后统一执行（P18），因此取消回滚时不会产生 owner 脏数据。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  ERR, TransferError, UNASSIGNED_WORKSPACE_ID, UNASSIGNED_WORKSPACE_TITLE,
} from './constants.js'
import type {
  ApplyRequest, ArchivePolicy, BundleSummary, Decision, ImportPreview, ResultRow,
  SessionEntryV2, SessionItem, TransferManifestV2, WorkspaceMapping,
} from './types.js'
import type { BatchRecord, JobStore, PreviewRecord } from './jobs.js'
import { progressPercent } from './jobs.js'
import type { HostContext, Services, CatalogLike, SessionHeaderLike } from './host.js'
import { warn } from './host.js'
import { checkSessionLogHeader, crossCheckMembers, parseManifest } from './manifest.js'
import { restoreAttachments } from './attachments.js'
import { defaultWorkspaceRoot, rewriteCwd } from './paths.js'
import type { ExtractResult } from './zip.js'
import { extractZipTo, memberPath, writeUploadTo } from './zip.js'
import { restoreWorkspaceFiles, targetDirState } from './workspace-files.js'

export interface ImportContext {
  readonly ctx: HostContext
  readonly services: Services
  readonly catalog: CatalogLike
  readonly jobs: JobStore
  readonly actor: { principalId: string; organizationId: string; requestId: string }
  readonly home: string
}

interface ResolvedTarget {
  readonly path: string
  readonly workspaceId: string
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

/**
 * 处理上传的 ZIP 字节流：落临时文件 → 解包 → 校验 → 生成 preview token。
 * 整包拒绝时返回带 rejection 的 preview，前端显示红色横幅并禁用导入。
 */
export async function importPreview(
  context: ImportContext,
  body: ReadableStream<Uint8Array> | null | undefined,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  const directory = await context.jobs.createPreviewDirectory()
  const archivePath = join(directory, 'bundle.zip')
  const contentRoot = join(directory, 'content')
  try {
    await writeUploadTo(body, archivePath, signal)
    const extract = await extractZipTo(archivePath, contentRoot, { signal })

    const manifest = await readManifest(contentRoot, extract)
    const verdict = await validateLogs(context, contentRoot, extract, manifest)
    if ('rejection' in verdict) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      return verdict.rejection
    }

    const record = context.jobs.putPreview({
      directory, archivePath, extract, manifest, logTexts: verdict.logTexts,
    })
    const localWorkspaces = (context.services.registry.list() ?? []).map((ws) => ({
      id: ws.id, title: ws.title, path: ws.path,
    }))
    const mapping = await buildMapping(context, manifest)
    const conflicts = await findConflicts(context, manifest)
    const summary = buildSummary(manifest, verdict.sourceVersion, context.catalog.currentVersion, verdict.migration)

    return {
      token: record.token,
      summary,
      localWorkspaces,
      workspaces: mapping,
      sessions: manifest.sessions.map((session): SessionItem => ({
        id: session.id,
        title: session.title,
        workspaceId: session.workspaceId,
        sizeBytes: session.sizeBytes ?? 0,
        at: new Date(session.createdAt || Date.now()).toISOString(),
        archived: session.archived,
        running: false,
        opened: false,
        subs: 0,
        ...(session.parentSession !== undefined ? { parentSession: session.parentSession } : {}),
        conflict: conflicts.includes(session.id),
      })),
      conflicts,
      archiveDefault: manifest.archivePolicy,
      versionVerdict: verdict.migration ? 'migration-required' : 'current',
      targetDirStatus: mapping.some((m) => m.status === 'invalid') ? 'invalid' : 'ok',
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    if (error instanceof TransferError) throw error
    throw new TransferError(ERR.invalidPackage, `无法读取会话迁移包：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function readManifest(contentRoot: string, extract: ExtractResult): Promise<TransferManifestV2> {
  let text: string
  try {
    text = await readFile(memberPath(contentRoot, extract.wrapper, 'manifest.json'), 'utf8')
  } catch {
    throw new TransferError(ERR.invalidPackage, '包内缺少 manifest.json，这不是本功能生成的会话迁移包。')
  }
  const manifest = parseManifest(text)
  // 成员名安全 + 声明的会话/附件/文件都存在（不安全成员由 extractZipTo 提前拒绝）
  const members = new Set(extract.members.keys())
  crossCheckMembers(manifest, members)
  return manifest
}

type ValidationResult =
  | { logTexts: ReadonlyMap<string, string>; sourceVersion: number; migration: boolean }
  | { rejection: ImportPreview }

async function validateLogs(
  context: ImportContext,
  contentRoot: string,
  extract: ExtractResult,
  manifest: TransferManifestV2,
): Promise<ValidationResult> {
  const localVersion = context.catalog.currentVersion
  const logTexts = new Map<string, string>()
  for (const session of manifest.sessions) {
    try {
      logTexts.set(session.id, await readFile(memberPath(contentRoot, extract.wrapper, session.logName), 'utf8'))
    } catch {
      return { rejection: reject(ERR.invalidPackage, '无法读取包内会话日志。', localVersion) }
    }
  }
  const first = logTexts.get(manifest.sessions[0].id) ?? ''
  let header: unknown
  try {
    header = JSON.parse(first.split('\n', 1)[0] ?? '')
  } catch {
    return { rejection: reject(ERR.logCorrupt, '会话日志首行不是合法 JSON。', localVersion) }
  }
  const verdict = context.catalog.readHeader(header)
  const sourceVersion = verdict.storedVersion ?? manifest.format.sessionVersion
  if (verdict.status === 'unsupported' || verdict.status === 'malformed' || sourceVersion > localVersion) {
    return { rejection: reject(ERR.versionUnsupported,
      `此包来自更新版本的客户端（v${sourceVersion}），当前客户端为 v${localVersion}，请升级后重试。`, localVersion,
      'unsupported') }
  }
  if (sourceVersion !== manifest.format.sessionVersion) {
    return { rejection: reject(ERR.logCorrupt, '会话日志格式版本与 manifest 不一致。', localVersion) }
  }
  for (const session of manifest.sessions) {
    try {
      checkSessionLogHeader(logTexts.get(session.id) ?? '', session, sourceVersion)
    } catch (error) {
      return { rejection: reject(ERR.logCorrupt, error instanceof Error ? error.message : String(error), localVersion) }
    }
  }
  return { logTexts, sourceVersion, migration: verdict.status === 'migration-required' }
}

function reject(code: string, message: string, localVersion: number, verdict: 'unsupported' | 'malformed' = 'malformed'): ImportPreview {
  return {
    token: '',
    summary: {
      exportedAt: '', device: '', appVersion: '', dshVersion: '',
      sourceVersion: 0, localVersion,
      workspaceCount: 0, sessionCount: 0, attachmentCount: 0, archivedCount: 0,
      filesIncluded: false, fileCount: 0, fileBytes: 0, excludedCount: 0,
      missingAttachments: 0, versionVerdict: verdict,
    },
    localWorkspaces: [], workspaces: [], sessions: [], conflicts: [],
    archiveDefault: 'preserve', versionVerdict: verdict, targetDirStatus: 'invalid',
    rejection: { code, message },
  }
}

async function buildMapping(context: ImportContext, manifest: TransferManifestV2): Promise<WorkspaceMapping[]> {
  const local = (context.services.registry.list() ?? []).map((ws) => ({
    id: ws.id, title: ws.title, path: ws.path,
  }))
  const result: WorkspaceMapping[] = []
  for (const ws of manifest.workspaces) {
    const byPath = await context.services.registry.resolveByPath(ws.path).catch(() => undefined)
    // 上次导入是把源工作区新建到 ~/Documents/<标题>，路径与来源不同但仍是同一个工作区；
    // 只按路径匹配会让重复导入时不断新建同名目录，所以路径没命中时用唯一同名工作区兜底。
    const sameTitle = byPath === undefined
      ? local.filter((item) => item.title.trim() !== '' && item.title.trim() === ws.title.trim())
      : []
    const matched = byPath ?? (sameTitle.length === 1 ? sameTitle[0] : undefined)
    if (matched !== undefined) {
      result.push({
        id: ws.id, title: ws.title, sourcePath: ws.path,
        targetId: matched.id, targetPath: matched.path, status: 'matched',
      })
      continue
    }
    // 未匹配：给出本机「新建目录」建议路径（平台中立，不硬编码盘符/用户名）。
    const suggested = defaultWorkspaceRoot(process.platform, homedir(), ws.title)
    const state = await targetDirState(suggested)
    result.push({
      id: ws.id, title: ws.title, sourcePath: ws.path,
      targetId: '__new__', targetPath: suggested,
      status: state === 'not-empty' ? 'invalid' : 'fallback',
    })
  }
  // 未归属工作区的会话没有源工作区，单独给一行映射，默认落到本机已有工作区（没有则新建目录）。
  if (manifest.sessions.some((session) => session.workspaceId === '')) {
    const fallback = local[0]
    if (fallback !== undefined) {
      result.push({
        id: UNASSIGNED_WORKSPACE_ID, title: UNASSIGNED_WORKSPACE_TITLE, sourcePath: '',
        targetId: fallback.id, targetPath: fallback.path, status: 'matched',
      })
    } else {
      const suggested = defaultWorkspaceRoot(process.platform, homedir(), '会话导入')
      const state = await targetDirState(suggested)
      result.push({
        id: UNASSIGNED_WORKSPACE_ID, title: UNASSIGNED_WORKSPACE_TITLE, sourcePath: '',
        targetId: '__new__', targetPath: suggested,
        status: state === 'not-empty' ? 'invalid' : 'fallback',
      })
    }
  }
  return result
}

async function findConflicts(context: ImportContext, manifest: TransferManifestV2): Promise<string[]> {
  const existing = new Set((await context.services.persistence.list()).map((s) => s.header.id))
  return manifest.sessions.filter((s) => existing.has(s.id)).map((s) => s.id)
}

function buildSummary(
  manifest: TransferManifestV2, sourceVersion: number, localVersion: number, migration: boolean,
): BundleSummary {
  return {
    exportedAt: manifest.exportedAt,
    device: manifest.client.device ?? '未知设备',
    appVersion: manifest.client.appVersion ?? '未知版本',
    dshVersion: manifest.client.dshVersion,
    sourceVersion, localVersion,
    workspaceCount: manifest.workspaces.length,
    sessionCount: manifest.sessions.length,
    attachmentCount: manifest.attachments.length,
    archivedCount: manifest.sessions.filter((s) => s.archived).length,
    filesIncluded: manifest.workspaceFiles.included,
    fileCount: manifest.workspaceFiles.totals.fileCount,
    fileBytes: manifest.workspaceFiles.totals.byteLength,
    excludedCount: manifest.workspaceFiles.skipped.length,
    missingAttachments: manifest.missingAttachments.length,
    versionVerdict: migration ? 'migration-required' : 'current',
  }
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

export async function importApply(context: ImportContext, request: ApplyRequest): Promise<string> {
  const preview = context.jobs.takePreview(request.token)
  if (preview === undefined) {
    throw new TransferError(ERR.invalidRequest, '导入预览已过期，请重新选择文件。')
  }
  const selected = request.decisions.filter((d) => d.importAsNew).map((d) => d.sessionId)
  const batch = context.jobs.createBatch(selected.length)
  void runBatch(context, preview, request, batch).catch((error) => {
    context.jobs.update(batch, { state: 'failed', error: { code: ERR.failed, message: String(error) } })
  })
  return batch.batchId
}

async function runBatch(
  context: ImportContext,
  preview: PreviewRecord,
  request: ApplyRequest,
  batch: BatchRecord,
): Promise<void> {
  const signal = batch.controller.signal
  const decisions = new Map(request.decisions.map((d) => [d.sessionId, d]))
  const selected = preview.manifest.sessions.filter((s) => decisions.get(s.id)?.importAsNew === true)
  const results: ResultRow[] = []
  const contentRoot = join(preview.directory, 'content')
  const archivePolicy: ArchivePolicy = request.archivePolicy

  try {
    // 1. 解析/新建目标工作区（Step 2 只收集草稿，apply 才落盘）
    context.jobs.setPhase(batch, 'validate', '校验目标工作区', 5)
    const targets = new Map<string, ResolvedTarget>()
    for (const mapping of request.mapping) {
      signal.throwIfAborted()
      targets.set(mapping.id, await resolveTarget(context, mapping, batch, signal))
    }

    // 2. 冲突 ID 重映射（整组一致，父在子前）
    const conflicts = await findConflicts(context, preview.manifest)
    const idMap = buildIdMap(selected, conflicts)

    // 3. 逐会话导入
    let done = 0
    for (const session of orderedSessions(selected)) {
      signal.throwIfAborted()
      const decision = decisions.get(session.id)
      if (decision === undefined) continue
      const target = targets.get(decision.targetWorkspaceId) ?? targets.get(session.workspaceId)
      if (target === undefined) {
        results.push({ sessionId: session.id, title: session.title, status: 'failed', reason: '未选择目标工作区。' })
        continue
      }
      try {
        results.push(await importOne(context, preview, contentRoot, session, decision, target, idMap, archivePolicy, batch, signal))
      } catch (error) {
        if (signal.aborted) throw error
        results.push({ sessionId: session.id, title: session.title, status: 'failed',
          reason: error instanceof Error ? error.message : String(error) })
      }
      done += 1
      context.jobs.setPhase(batch, 'logs', `导入会话 ${done}/${selected.length}`, progressPercent(done, selected.length))
    }

    // 每个阶段边界都检查取消信号：用户在进度条任意时刻点「取消」都必须能触发
    // rollback，而不是让批次继续跑到 done（P7：取消 = 停止后续 + 回滚本批次全部）。
    // 已写入的附件/源文件都登记在 batch.writtenFiles，回滚会逐个删除。

    // 4. 附件回写（内容寻址，sha 校验通过才落盘；本次新建的路径进入回滚清单）
    signal.throwIfAborted()
    context.jobs.setPhase(batch, 'attachments', '还原附件', 88)
    const attachmentStats = await restoreAttachments(
      preview.manifest, preview.extract, contentRoot, context.home, batch, signal,
    )

    // 5. 工作区文件（整批校验后原子落盘）
    signal.throwIfAborted()
    let fileStats: { restored: number; skipped: number } | undefined
    if (preview.manifest.workspaceFiles.included && preview.manifest.workspaceFiles.files.length > 0) {
      context.jobs.setPhase(batch, 'workspace-files', '还原工作区源文件', 92)
      const staging = join(preview.directory, 'staging')
      await mkdir(staging, { recursive: true, mode: 0o700 })
      batch.tempDirectories.push(staging)
      const restored = await restoreWorkspaceFiles(
        preview.manifest.workspaceFiles.files,
        (entry) => readFile(memberPath(contentRoot, preview.extract.wrapper,
          `workspace/${entry.workspaceId}/${entry.path}`)),
        new Map([...targets].map(([id, target]) => [id, target.path])),
        staging,
      )
      batch.writtenFiles.push(...restored.written)
      fileStats = { restored: restored.restored, skipped: restored.skipped.length }
    }
    for (const row of results) {
      if (row.status !== 'imported') continue
      results[results.indexOf(row)] = {
        ...row,
        ...(fileStats !== undefined ? { filesRestored: fileStats.restored, filesSkipped: fileStats.skipped } : {}),
        attachmentsRestored: attachmentStats.restored,
        attachmentsSkipped: attachmentStats.skipped,
      }
    }

    // 6. 归档状态已在逐会话导入时按策略恢复；此处只推进度相位
    signal.throwIfAborted()
    context.jobs.setPhase(batch, 'archive', '整理归档状态', 94)

    // 7. 批次末统一绑定 owner（P18）；失败不回滚已落盘数据，只在结果页报告
    signal.throwIfAborted()
    context.jobs.setPhase(batch, 'bind', '绑定会话归属', 96)
    const bindFailure = await bindAll(context, batch, targets, selected, decisions, idMap, signal)

    signal.throwIfAborted()
    await writeImportAudit(context, preview.manifest, results)
    context.jobs.update(batch, {
      state: 'done', phase: 'done', percent: 100, done: selected.length,
      current: '导入完成', cancellable: false, result: results,
      // 批次级提示只出现一次，不写进每一行
      ...(bindFailure === undefined ? {} : { warning: bindFailure }),
    })
  } catch (error) {
    await rollback(context, batch)
    if (signal.aborted) {
      context.jobs.update(batch, {
        state: 'cancelled', phase: 'done', percent: 0, current: '已取消，本次未导入任何会话',
        cancellable: false, result: [],
      })
    } else {
      context.jobs.update(batch, {
        state: 'failed', phase: 'done', cancellable: false, result: results,
        error: { code: ERR.failed, message: error instanceof Error ? error.message : String(error) },
      })
    }
  } finally {
    void context.jobs.dropPreview(preview.token)
  }
}

/** 为冲突会话生成新 ID；同一批内保持前缀一致，父子引用同步改写。 */
function buildIdMap(selected: readonly SessionEntryV2[], conflicts: readonly string[]): ReadonlyMap<string, string> {
  const conflictSet = new Set(conflicts)
  const suffix = randomUUID().slice(0, 8)
  const map = new Map<string, string>()
  for (const session of selected) {
    if (conflictSet.has(session.id)) map.set(session.id, `${session.id}-import-${suffix}`)
  }
  return map
}

/** 父会话在子会话之前。 */
function orderedSessions(sessions: readonly SessionEntryV2[]): SessionEntryV2[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const ordered: SessionEntryV2[] = []
  const seen = new Set<string>()
  const visit = (session: SessionEntryV2): void => {
    if (seen.has(session.id)) return
    seen.add(session.id)
    const parent = session.parentSession !== undefined ? byId.get(session.parentSession) : undefined
    if (parent !== undefined) visit(parent)
    ordered.push(session)
  }
  for (const session of sessions) visit(session)
  return ordered
}

async function importOne(
  context: ImportContext,
  preview: PreviewRecord,
  contentRoot: string,
  session: SessionEntryV2,
  decision: Decision,
  target: ResolvedTarget,
  idMap: ReadonlyMap<string, string>,
  archivePolicy: ArchivePolicy,
  batch: BatchRecord,
  signal: AbortSignal,
): Promise<ResultRow> {
  const text = preview.logTexts.get(session.id)
  if (text === undefined) throw new Error('会话日志缺失')
  const lines = text.split('\n').filter((line) => line !== '')
  const headerValue = JSON.parse(lines[0] ?? '{}') as unknown

  // 版本恢复链路（红线 1）：readHeader → createRestore → decodeRow → finish
  const verdict = context.catalog.readHeader(headerValue)
  if (verdict.status === 'unsupported' || verdict.status === 'malformed') {
    throw new TransferError(ERR.versionUnsupported, '会话日志格式不受支持。')
  }
  const restore = context.catalog.createRestore(headerValue, { recovery: 'strict', validation: 'transformed' })
  const newId = idMap.get(session.id) ?? session.id
  for (let index = 1; index < lines.length; index += 1) {
    signal.throwIfAborted()
    let row: unknown = JSON.parse(lines[index] ?? '{}')
    row = rewriteStructuredPaths(row, preview.manifest, session, target.path, newId !== session.id, idMap)
    restore.decodeRow(row)
  }
  const artifact = restore.finish()

  const header = toSessionHeader(artifact.header, newId, session, idMap, preview.manifest, target.path)
  const handle = await context.services.persistence.create(header, {
    inheritedEventCount: artifact.inheritedEventCount, signal,
  })
  batch.createdSessionIds.push(newId)
  try {
    await handle.append(artifact.events, { signal })
    await handle.flush({ signal })
  } finally {
    await handle.close().catch(() => undefined)
  }

  // attachSession 在 Workspace 上，不在 Registry 上
  const workspace = context.services.registry.get(target.workspaceId)
  if (workspace === undefined) throw new Error(`目标工作区 ${target.workspaceId} 不存在。`)
  await workspace.attachSession(newId)

  // 预热官方投影缓存：不预热的话侧栏与「会话迁移」导出列表都只能拿到会话 id（无 title 投影）
  seedProjections(context, header, artifact.inheritedEventCount, artifact.events)

  // 归档策略 [P9]
  if (archivePolicy === 'preserve' && session.archived) {
    try {
      await context.services.registry.archiveSession(newId)
    } catch (error) {
      warn(context.ctx, `会话迁移导入：恢复归档失败（${String(error)}）。`)
    }
  }

  return {
    sessionId: newId,
    title: newId !== session.id ? `${session.title}（导入）` : session.title,
    status: 'imported',
    ...(preview.manifest.missingAttachments.length > 0
      ? { missingAttachments: [...preview.manifest.missingAttachments] } : {}),
    ...(verdict.status === 'migration-required'
      ? { versionNote: `v${verdict.storedVersion ?? preview.manifest.format.sessionVersion} → v${context.catalog.currentVersion} 已升级` } : {}),
  }
}

/**
 * 用官方投影缓存的冷读折叠写入导入会话的投影（含 title / sessionListMetadata.blank）。
 * 导入是直接落盘、不会走官方「打开会话」链路，缺这一步时列表只能显示会话 id。
 * 失败只告警：不影响导入结果，导出列表仍有读日志兜底。
 */
function seedProjections(
  context: ImportContext,
  header: unknown,
  inheritedEventCount: number,
  events: readonly unknown[],
): void {
  try {
    const cache = context.ctx.get('sessionProjectionCache') as
      | { coldSnapshot?(meta: unknown, inherited: number, rows: readonly unknown[]): unknown }
      | undefined
    cache?.coldSnapshot?.(header, inheritedEventCount, events)
  } catch (error) {
    warn(context.ctx, `会话迁移导入：投影缓存预热失败（${String(error)}）。`)
  }
}

/** 只改结构化字段：cwd 与会话 id 引用；绝不改事件文本里的路径字符串（红线 2）。 */
function rewriteStructuredPaths(
  row: unknown,
  manifest: TransferManifestV2,
  session: SessionEntryV2,
  targetPath: string,
  hasSuffix: boolean,
  idMap: ReadonlyMap<string, string>,
): unknown {
  if (typeof row !== 'object' || row === null) return row
  const event = { ...(row as Record<string, unknown>) }
  const sourcePath = manifest.workspaces.find((ws) => ws.id === session.workspaceId)?.path ?? session.cwd ?? ''

  if (event.type === 'working-directory/change') {
    const data = event.data
    if (typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).cwd === 'string') {
      event.data = { ...(data as Record<string, unknown>),
        cwd: rewriteCwd((data as Record<string, unknown>).cwd as string, sourcePath, targetPath) }
    }
  }
  // 标题后缀：仅 ID 冲突重映射时，写进 session/title 事件而非只改 manifest
  if (event.type === 'session/title' && hasSuffix) {
    const data = event.data
    if (typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).title === 'string') {
      event.data = { ...(data as Record<string, unknown>),
        title: `${(data as Record<string, unknown>).title as string}（导入）` }
    }
  }
  // 结构化 id 引用（父子关系）；不动任何路径字符串
  if (idMap.size > 0) {
    for (const key of ['sessionId', 'parentSession', 'targetSessionId'] as const) {
      const value = event[key]
      if (typeof value === 'string' && idMap.has(value)) event[key] = idMap.get(value)
    }
    const data = event.data
    if (typeof data === 'object' && data !== null) {
      const copy = { ...(data as Record<string, unknown>) }
      let changed = false
      for (const key of ['sessionId', 'parentSession', 'targetSessionId'] as const) {
        const value = copy[key]
        if (typeof value === 'string' && idMap.has(value)) {
          copy[key] = idMap.get(value)
          changed = true
        }
      }
      if (changed) event.data = copy
    }
  }
  return event
}

function toSessionHeader(
  formatHeader: Record<string, unknown>,
  newId: string,
  session: SessionEntryV2,
  idMap: ReadonlyMap<string, string>,
  manifest: TransferManifestV2,
  targetPath: string,
): SessionHeaderLike {
  const sourcePath = manifest.workspaces.find((ws) => ws.id === session.workspaceId)?.path ?? session.cwd ?? ''
  const cwd = rewriteCwd(session.cwd, sourcePath, targetPath)
  const parent = typeof formatHeader.parentSession === 'string'
    ? (idMap.get(formatHeader.parentSession) ?? formatHeader.parentSession)
    : session.parentSession !== undefined
      ? (idMap.get(session.parentSession) ?? session.parentSession)
      : undefined
  return {
    version: typeof formatHeader.version === 'number' ? formatHeader.version : manifest.format.sessionVersion,
    id: newId,
    createdAt: typeof formatHeader.createdAt === 'number' ? formatHeader.createdAt : session.createdAt,
    ...(cwd !== '' ? { cwd } : {}),
    ...(parent !== undefined ? { parentSession: parent } : {}),
    isSeeded: formatHeader.isSeeded === true,
    ...(formatHeader.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
    ...(typeof formatHeader.delegationDepth === 'number' ? { delegationDepth: formatHeader.delegationDepth } : {}),
    ...(typeof formatHeader.agentPreset === 'string' ? { agentPreset: formatHeader.agentPreset } : {}),
  }
}

/** 解析/新建目标工作区。新建目录只在 apply 阶段落盘，取消可完整回滚。 */
async function resolveTarget(
  context: ImportContext,
  mapping: WorkspaceMapping,
  batch: BatchRecord,
  signal: AbortSignal,
): Promise<ResolvedTarget> {
  signal.throwIfAborted()
  if (mapping.targetId !== '' && mapping.targetId !== '__new__') {
    const existing = context.services.registry.get(mapping.targetId)
    if (existing !== undefined) return { path: existing.path, workspaceId: existing.id }
  }
  const candidate = mapping.targetPath || defaultWorkspaceRoot(process.platform, homedir(), mapping.title)
  const state = await targetDirState(candidate)
  if (state === 'not-empty') {
    throw new TransferError(ERR.targetNotEmpty, `目标目录「${candidate}」已有内容，请选择空目录或新建目录。`)
  }
  if (state === 'missing') {
    await mkdir(candidate, { recursive: true, mode: 0o700 })
    batch.createdDirectories.push(candidate)
  }
  const workspace = await context.services.registry.create(candidate, mapping.title)
  batch.registeredWorkspaceIds.push(workspace.id)
  return { path: workspace.path, workspaceId: workspace.id }
}

/** 批次末统一绑定；返回失败提示（不回滚已落盘数据）。 */
async function bindAll(
  context: ImportContext,
  batch: BatchRecord,
  targets: ReadonlyMap<string, ResolvedTarget>,
  selected: readonly SessionEntryV2[],
  decisions: ReadonlyMap<string, Decision>,
  idMap: ReadonlyMap<string, string>,
  signal: AbortSignal,
): Promise<string | undefined> {
  const access = context.services.access
  if (access === undefined) return '会话归属绑定服务不可用，请重新登录后重试绑定。'
  let failures = 0
  for (const session of selected) {
    signal.throwIfAborted()
    const decision = decisions.get(session.id)
    const target = targets.get(decision?.targetWorkspaceId ?? session.workspaceId)
    if (target === undefined) continue
    const newId = idMap.get(session.id) ?? session.id
    try {
      // 旧绑定不会因为本地会话数据被清空而消失：同一主体的历史归属记录直接复用，
      // 否则重新导入同名会话时每一步都会报 owner-conflict。
      const existing = access.sessionOwner?.(newId)
      if (existing !== undefined) {
        batch.pendingBindSessionIds.push(newId)
        if (existing.organizationId === context.actor.organizationId
          && existing.ownerPrincipalId === context.actor.principalId) continue
        failures += 1
        continue
      }
      await access.bindSession(context.actor, { sessionId: newId, workspaceId: target.workspaceId })
      batch.pendingBindSessionIds.push(newId)
    } catch {
      failures += 1
    }
  }
  return failures > 0 ? `有 ${failures} 个会话的归属绑定失败（transfer/bind-failed），请重新登录后重试。` : undefined
}

async function writeImportAudit(
  context: ImportContext, manifest: TransferManifestV2, results: readonly ResultRow[],
): Promise<void> {
  try {
    await context.services.audit?.append({
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      requestId: context.actor.requestId,
      principalId: context.actor.principalId,
      organizationId: context.actor.organizationId,
      action: 'session.transfer.import',
      outcome: 'succeeded',
      code: 'session/transfer-imported',
      references: {
        sessionCount: String(results.filter((r) => r.status === 'imported').length),
        failedCount: String(results.filter((r) => r.status === 'failed').length),
        fileCount: String(manifest.workspaceFiles.totals.fileCount),
        sourceVersion: String(manifest.format.sessionVersion),
        device: manifest.client.device ?? 'unknown',
      },
    })
  } catch (error) {
    warn(context.ctx, `会话迁移导入审计写入失败：${String(error)}`)
  }
}

/** 取消 / 批次级失败时逆序清理本批次全部副作用。 */
async function rollback(context: ImportContext, batch: BatchRecord): Promise<void> {
  const { services } = context
  for (const id of [...batch.createdSessionIds].reverse()) {
    try {
      // 用 context.home 而非 process.env：回滚路径必须与本次写入/预览根一致，
      // 否则环境变量变化或测试注入的 home 会让清理落到错误目录。
      const root = join(context.home, 'sessions')
      const projects = await readdir(root, { withFileTypes: true }).catch(() => [])
      for (const project of projects) {
        if (project.isDirectory()) {
          await rm(join(root, project.name, id), { recursive: true, force: true }).catch(() => undefined)
        }
      }
      await services.registry.unarchiveSession(id).catch(() => undefined)
    } catch (error) {
      warn(context.ctx, `会话迁移回滚：清理 ${id} 失败（${String(error)}）。`)
    }
  }
  for (const file of [...batch.writtenFiles].reverse()) {
    await rm(file, { force: true }).catch(() => undefined)
  }
  for (const dir of [...batch.tempDirectories, ...batch.createdDirectories].reverse()) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  for (const id of batch.registeredWorkspaceIds) {
    await services.registry.delete(id).catch(() => undefined)
  }
}
