/**
 * 会话迁移插件共享类型。
 *
 * 包格式 schema 2。所有类型同时被 Host 与 Client 使用，但不 import 任何官方
 * DSH 包，避免插件对运行时内部实现产生编译期耦合（见 README「实现契约」）。
 */

// ---------------------------------------------------------------------------
// manifest v2
// ---------------------------------------------------------------------------

export const TRANSFER_KIND = 'workdsh-session-transfer' as const
export const MANIFEST_SCHEMA = 2 as const

/** 附件在包内保留完整 ref：官方 AttachmentStore 无法仅凭 sha256 读回对象。 */
export interface AttachmentRefV2 {
  readonly id: string
  readonly kind: 'image' | 'file'
  readonly name?: string
  readonly mediaType?: string
  readonly bytes: number
  readonly width?: number
  readonly height?: number
  /** 包内成员名，形如 attachments/objects/ab/<sha> 或 attachments/file-objects/ab/<sha> */
  readonly member: string
  /** 官方 files/<2>/<sha>/<name> 别名相对路径（仅 file 类型且存在时） */
  readonly alias?: string
}

export interface SessionEntryV2 {
  readonly id: string
  readonly title: string
  readonly workspaceId: string
  readonly logName: string
  /** 导出机的事件格式版本（= sessionFormatCatalog.currentVersion） */
  readonly version: number
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: string
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly agentPreset?: string
  readonly eventCount?: number
  readonly sizeBytes?: number
  readonly archived: boolean
  readonly attachments: readonly string[]
}

export interface WorkspaceEntryV2 {
  readonly id: string
  readonly title: string
  /** 源设备绝对路径，仅作展示与「原路径清单」提示，导入端不据此拒绝包 */
  readonly path: string
}

export type SkipReason =
  | 'outside-workspace'
  | 'absolute-path'
  | 'excluded'
  | 'symlink'
  | 'too-large'
  | 'unreadable'
  | 'changed-during-export'

export interface WorkspaceFileEntryV2 {
  readonly workspaceId: string
  /** 相对 workspace root，一律 `/` 分隔 */
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  /** 是否保留可执行位（Linux） */
  readonly executable?: boolean
}

export interface WorkspaceFileSkipV2 {
  readonly path: string
  readonly reason: SkipReason
}

export interface WorkspaceFilesV2 {
  readonly included: boolean
  readonly policy: 'referenced-relative-only'
  /** 内置安全基线 + 密钥类，导入端不可被用户规则覆盖 */
  readonly excludes: readonly string[]
  /** 用户在导出页追加的规则 */
  readonly userExcludes: readonly string[]
  readonly files: readonly WorkspaceFileEntryV2[]
  readonly skipped: readonly WorkspaceFileSkipV2[]
  readonly totals: { readonly fileCount: number; readonly byteLength: number }
}

export type ArchivePolicy = 'preserve' | 'none'

export interface TransferManifestV2 {
  readonly schema: typeof MANIFEST_SCHEMA
  readonly kind: typeof TRANSFER_KIND
  readonly exportedAt: string
  readonly client: {
    readonly appVersion: string | null
    readonly dshVersion: string
    readonly device: string | null
    /** 仅作来源记录，导入端不得据此拒绝包或做平台分支 */
    readonly platform: string
  }
  readonly format: {
    /** 导出机当前事件格式版本，是 createRestore 的输入与 readHeader 交叉校验值 */
    readonly sessionVersion: number
    readonly logEncoding: 'none'
  }
  readonly workspaces: readonly WorkspaceEntryV2[]
  readonly sessions: readonly SessionEntryV2[]
  readonly attachments: readonly AttachmentRefV2[]
  readonly missingAttachments: readonly string[]
  readonly workspaceFiles: WorkspaceFilesV2
  readonly archivePolicy: ArchivePolicy
}

// ---------------------------------------------------------------------------
// 前端 view model
// ---------------------------------------------------------------------------

export interface SessionItem {
  id: string
  title: string
  workspaceId: string
  sizeBytes: number
  at: string
  archived: boolean
  /** true → 不可导出、置灰 */
  running: boolean
  /** 空闲但已打开 → 可导出，但必须先 flush */
  opened: boolean
  subs: number
  parentSession?: string
  /** 导入侧：本地已有同 ID */
  conflict?: boolean
  eventCount?: number
  attachmentCount?: number
}

export interface WorkspaceGroup {
  id: string
  title: string
  path: string
  sessions: SessionItem[]
}

export interface BundleSummary {
  exportedAt: string
  device: string
  appVersion: string
  dshVersion: string
  sourceVersion: number
  localVersion: number
  workspaceCount: number
  sessionCount: number
  attachmentCount: number
  archivedCount: number
  filesIncluded: boolean
  fileCount: number
  fileBytes: number
  excludedCount: number
  missingAttachments: number
  versionVerdict: VersionVerdict
}

export type VersionVerdict = 'current' | 'migration-required' | 'unsupported' | 'malformed' | 'corrupt'

export interface Decision {
  sessionId: string
  /** 勾选 = 导入为新会话；不勾选 = 跳过 */
  importAsNew: boolean
  targetWorkspaceId: string
}

export interface ResultRow {
  sessionId: string
  title: string
  status: 'imported' | 'not-imported' | 'failed'
  reason?: string
  missingAttachments?: string[]
  filesRestored?: number
  filesSkipped?: number
  attachmentsRestored?: number
  attachmentsSkipped?: number
  versionNote?: string
}

// ---------------------------------------------------------------------------
// 请求 / 响应
// ---------------------------------------------------------------------------

export interface ExportRequest {
  sessionIds: readonly string[]
  includeWorkspaceFiles: boolean
  /** 需要携带工作区文件的 workspace id；缺省 = 全部工作区（仅在 includeWorkspaceFiles 时生效） */
  fileWorkspaceIds?: readonly string[]
  userExcludes?: readonly string[]
  archivePolicy?: ArchivePolicy
}

export interface ExportPreview {
  sessions: SessionItem[]
  groups: WorkspaceGroup[]
  attachments: { count: number; bytes: number }
  workspaceFiles: { fileCount: number; byteLength: number; skipped: number }
  totals: { sessionCount: number; byteLength: number }
  exceeds: readonly string[]
}

export interface LocalWorkspaceOption {
  id: string
  title: string
  path: string
}

export interface ImportPreview {
  token: string
  summary: BundleSummary
  /** 本机已有工作区，供 Step 2 选择「导入到已有工作区」 */
  localWorkspaces: readonly LocalWorkspaceOption[]
  workspaces: readonly WorkspaceMapping[]
  sessions: readonly SessionItem[]
  conflicts: readonly string[]
  archiveDefault: ArchivePolicy
  versionVerdict: VersionVerdict
  targetDirStatus: 'ok' | 'missing' | 'invalid'
  /** 整包拒绝时的原因（versionVerdict=unsupported/malformed/corrupt） */
  rejection?: { code: string; message: string }
}

export interface WorkspaceMapping {
  id: string
  title: string
  sourcePath: string
  /** 本地工作区 id；'__new__' 表示新建目录；'' 表示未选择 */
  targetId: string
  targetPath: string
  status: 'matched' | 'fallback' | 'missing' | 'invalid'
}

export interface ApplyRequest {
  token: string
  decisions: readonly Decision[]
  mapping: readonly WorkspaceMapping[]
  archivePolicy: ArchivePolicy
}

export type JobPhase = 'validate' | 'logs' | 'attachments' | 'workspace-files' | 'archive' | 'bind' | 'done'

export interface JobStatus {
  phase: JobPhase
  percent: number
  done: number
  total: number
  current: string
  cancellable: boolean
  state: 'running' | 'done' | 'failed' | 'cancelled'
  result?: readonly ResultRow[]
  /** 批次级提示（例如归属绑定失败），只显示一次，不逐行重复 */
  warning?: string
  error?: { code: string; message: string }
}
