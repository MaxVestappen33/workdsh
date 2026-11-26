/**
 * manifest v2 的构建、解析与交叉校验。
 *
 * 纯逻辑（除 sha256 由调用方传入），不依赖 DSH 运行时。解析采用「白名单 +
 * 逐字段窄化」，任何类型不符都判 transfer/invalid-package，避免把不可信包内容
 * 直接当结构化数据使用。
 */

import { ERR, TransferError } from './constants.js'
import type {
  ArchivePolicy,
  AttachmentRefV2,
  SessionEntryV2,
  TransferManifestV2,
  WorkspaceEntryV2,
  WorkspaceFileEntryV2,
  WorkspaceFileSkipV2,
  WorkspaceFilesV2,
} from './types.js'
import { MANIFEST_SCHEMA, TRANSFER_KIND } from './types.js'
import { ATTACHMENT_ID, SESSION_ID } from './constants.js'
import { checkMember, sessionLogMember } from './paths.js'

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

export interface BuildManifestInput {
  readonly exportedAt: string
  readonly client: TransferManifestV2['client']
  readonly sessionVersion: number
  readonly workspaces: readonly WorkspaceEntryV2[]
  readonly sessions: readonly Omit<SessionEntryV2, 'logName'>[]
  readonly attachments: readonly AttachmentRefV2[]
  readonly missingAttachments: readonly string[]
  readonly workspaceFiles: WorkspaceFilesV2
  readonly archivePolicy: ArchivePolicy
}

export function buildManifest(input: BuildManifestInput): TransferManifestV2 {
  const sessions: SessionEntryV2[] = input.sessions.map((session) => ({
    ...session,
    logName: sessionLogMember(session.id),
  }))
  return {
    schema: MANIFEST_SCHEMA,
    kind: TRANSFER_KIND,
    exportedAt: input.exportedAt,
    client: input.client,
    format: { sessionVersion: input.sessionVersion, logEncoding: 'none' },
    workspaces: input.workspaces,
    sessions,
    attachments: input.attachments,
    missingAttachments: input.missingAttachments,
    workspaceFiles: input.workspaceFiles,
    archivePolicy: input.archivePolicy,
  }
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function bool(value: unknown): boolean {
  return value === true
}
function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}
function strArray(value: unknown): readonly string[] {
  return array(value).filter((item): item is string => typeof item === 'string')
}

const SKIP_REASONS = new Set([
  'outside-workspace', 'absolute-path', 'excluded', 'symlink',
  'too-large', 'unreadable', 'changed-during-export',
])

function parseWorkspaceFiles(value: unknown): WorkspaceFilesV2 {
  if (!isRecord(value)) {
    return { included: false, policy: 'referenced-relative-only', excludes: [], userExcludes: [], files: [], skipped: [], totals: { fileCount: 0, byteLength: 0 } }
  }
  const included = bool(value.included)
  const files: WorkspaceFileEntryV2[] = array(value.files).flatMap((item): WorkspaceFileEntryV2[] => {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.sha256 !== 'string') return []
    if (typeof item.workspaceId !== 'string') return []
    return [{
      workspaceId: item.workspaceId,
      path: item.path,
      sha256: item.sha256,
      bytes: num(item.bytes),
      ...(bool(item.executable) ? { executable: true } : {}),
    }]
  })
  const skipped: WorkspaceFileSkipV2[] = array(value.skipped).flatMap((item): WorkspaceFileSkipV2[] => {
    if (!isRecord(item) || typeof item.path !== 'string') return []
    const reason = str(item.reason) as WorkspaceFileSkipV2['reason']
    return [{ path: item.path, reason: SKIP_REASONS.has(reason) ? reason : 'unreadable' }]
  })
  const totals = isRecord(value.totals) ? value.totals : {}
  return {
    included,
    policy: 'referenced-relative-only',
    excludes: strArray(value.excludes),
    userExcludes: strArray(value.userExcludes),
    files,
    skipped,
    totals: { fileCount: num(totals.fileCount, files.length), byteLength: num(totals.byteLength) },
  }
}

/**
 * 解析 manifest 文本。schema 高于本机支持 → transfer/unsupported-schema；
 * 低于或 kind 不符 → transfer/invalid-package。
 */
export function parseManifest(text: string): TransferManifestV2 {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new TransferError(ERR.invalidPackage, '包内 manifest.json 不是合法 JSON。')
  }
  if (!isRecord(raw)) throw new TransferError(ERR.invalidPackage, 'manifest.json 格式不正确。')
  if (raw.kind !== TRANSFER_KIND) {
    throw new TransferError(ERR.invalidPackage, '这不是本功能生成的会话迁移包。')
  }
  if (typeof raw.schema !== 'number' || !Number.isInteger(raw.schema)) {
    throw new TransferError(ERR.invalidPackage, 'manifest.json 缺少有效的 schema 版本。')
  }
  if (raw.schema > MANIFEST_SCHEMA) {
    throw new TransferError(ERR.unsupportedSchema, '此包来自更新版本的客户端，请升级后重试。')
  }
  if (raw.schema < MANIFEST_SCHEMA) {
    throw new TransferError(ERR.invalidPackage, '此包格式过旧，请用当前版本客户端重新导出。')
  }

  const client = isRecord(raw.client) ? raw.client : {}
  const format = isRecord(raw.format) ? raw.format : {}
  if (format.logEncoding !== 'none') {
    throw new TransferError(ERR.invalidPackage, '不支持的会话日志编码。')
  }
  const sessionVersion = num(format.sessionVersion, NaN)
  if (!Number.isInteger(sessionVersion) || sessionVersion < 0) {
    throw new TransferError(ERR.invalidPackage, 'manifest.json 缺少有效的 format.sessionVersion。')
  }

  const workspaces: WorkspaceEntryV2[] = array(raw.workspaces).flatMap((item): WorkspaceEntryV2[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.path !== 'string') return []
    return [{ id: item.id, title: str(item.title, item.id), path: item.path }]
  })

  const sessions: SessionEntryV2[] = array(raw.sessions).flatMap((item): SessionEntryV2[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || !SESSION_ID.test(item.id)) return []
    if (typeof item.logName !== 'string' || typeof item.workspaceId !== 'string') return []
    const origin = item.origin === 'subagent' ? 'subagent' : undefined
    return [{
      id: item.id,
      title: str(item.title, item.id),
      workspaceId: item.workspaceId,
      logName: item.logName,
      version: num(item.version, sessionVersion),
      createdAt: num(item.createdAt),
      ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : {}),
      ...(typeof item.parentSession === 'string' ? { parentSession: item.parentSession } : {}),
      ...(origin !== undefined ? { origin } : {}),
      ...(typeof item.delegationDepth === 'number' ? { delegationDepth: item.delegationDepth } : {}),
      ...(typeof item.agentPreset === 'string' ? { agentPreset: item.agentPreset } : {}),
      ...(typeof item.eventCount === 'number' ? { eventCount: item.eventCount } : {}),
      archived: bool(item.archived),
      attachments: strArray(item.attachments),
    }]
  })
  if (sessions.length === 0) {
    throw new TransferError(ERR.invalidPackage, '包内没有可导入的会话。')
  }

  const attachments: AttachmentRefV2[] = array(raw.attachments).flatMap((item): AttachmentRefV2[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || !ATTACHMENT_ID.test(item.id)) return []
    if (typeof item.member !== 'string' || typeof item.bytes !== 'number') return []
    const kind = item.kind === 'image' ? 'image' : 'file'
    return [{
      id: item.id,
      kind,
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.mediaType === 'string' ? { mediaType: item.mediaType } : {}),
      bytes: item.bytes,
      ...(typeof item.width === 'number' ? { width: item.width } : {}),
      ...(typeof item.height === 'number' ? { height: item.height } : {}),
      member: item.member,
      ...(typeof item.alias === 'string' ? { alias: item.alias } : {}),
    }]
  })

  const archivePolicy: ArchivePolicy = raw.archivePolicy === 'none' ? 'none' : 'preserve'

  return {
    schema: MANIFEST_SCHEMA,
    kind: TRANSFER_KIND,
    exportedAt: str(raw.exportedAt),
    client: {
      appVersion: typeof client.appVersion === 'string' ? client.appVersion : null,
      dshVersion: str(client.dshVersion),
      device: typeof client.device === 'string' ? client.device : null,
      platform: str(client.platform),
    },
    format: { sessionVersion, logEncoding: 'none' },
    workspaces,
    sessions,
    attachments,
    missingAttachments: strArray(raw.missingAttachments),
    workspaceFiles: parseWorkspaceFiles(raw.workspaceFiles),
    archivePolicy,
  }
}

// ---------------------------------------------------------------------------
// 与包内成员交叉校验
// ---------------------------------------------------------------------------

/**
 * 校验 manifest 声明的会话日志与工作区文件是否都真实存在于包内，且成员名安全。
 * 会话日志首行 header 的校验在导入流程里做（需要读文件内容）。
 */
export function crossCheckMembers(manifest: TransferManifestV2, members: ReadonlySet<string>): void {
  for (const member of members) {
    const check = checkMember(member)
    if (!check.safe) {
      throw new TransferError(ERR.unsafeMember, `包内包含不安全的成员路径：${member}`)
    }
  }
  for (const session of manifest.sessions) {
    if (!members.has(session.logName)) {
      throw new TransferError(ERR.invalidPackage, `包内缺少会话日志 ${session.logName}。`)
    }
  }
  if (manifest.workspaceFiles.included) {
    for (const file of manifest.workspaceFiles.files) {
      const member = `workspace/${file.workspaceId}/${file.path}`
      if (!members.has(member)) {
        throw new TransferError(ERR.invalidPackage, `包内缺少工作区文件 ${member}。`)
      }
    }
  }
  for (const attachment of manifest.attachments) {
    if (!members.has(attachment.member)) {
      throw new TransferError(ERR.invalidPackage, `包内缺少附件 ${attachment.member}。`)
    }
  }
}

/** 校验会话日志首行 header（导出端产出的是当前格式明文 JSONL）。 */
export function checkSessionLogHeader(
  text: string,
  session: SessionEntryV2,
  expectedVersion: number,
): { version: number; id: string } {
  const firstLine = text.split('\n', 1)[0] ?? ''
  let header: unknown
  try {
    header = JSON.parse(firstLine)
  } catch {
    throw new TransferError(ERR.logCorrupt, `会话 ${session.id} 的日志首行不是合法 JSON。`)
  }
  if (!isRecord(header) || typeof header.version !== 'number' || typeof header.id !== 'string') {
    throw new TransferError(ERR.logCorrupt, `会话 ${session.id} 的日志头缺少 version/id。`)
  }
  if (header.id !== session.id) {
    throw new TransferError(ERR.logCorrupt, `会话 ${session.id} 的日志头编号不一致。`)
  }
  if (header.version !== session.version || header.version !== expectedVersion) {
    throw new TransferError(ERR.logCorrupt, `会话 ${session.id} 的日志格式版本与 manifest 不一致。`)
  }
  return { version: header.version, id: header.id }
}
