/**
 * 插件常量：路由、错误码、排除表与阈值。
 * 阈值全部集中在此，便于实现方按真实工程目录实测后回填（P8）。
 */

// ---------------------------------------------------------------------------
// HTTP 路由（ConnectionFetchRoute.path 必须是 /api 下的绝对路径）
// ---------------------------------------------------------------------------

export const ROUTES = Object.freeze({
  exportPreview: '/api/session.transfer.export.preview',
  exportRun: '/api/session.transfer.export',
  exportStatus: '/api/session.transfer.export.status',
  importPreview: '/api/session.transfer.import.preview',
  importApply: '/api/session.transfer.import.apply',
  importStatus: '/api/session.transfer.import.status',
  importCancel: '/api/session.transfer.import.cancel',
})

/** 上传走 streaming，绕开 buffered 的 300 MiB 默认上限。 */
export const STREAMING_ROUTE = ROUTES.importPreview

// ---------------------------------------------------------------------------
// 错误码（§9）
// ---------------------------------------------------------------------------

export const ERR = Object.freeze({
  invalidPackage: 'transfer/invalid-package',
  unsupportedSchema: 'transfer/unsupported-schema',
  unsafeMember: 'transfer/unsafe-member',
  logCorrupt: 'transfer/log-corrupt',
  versionUnsupported: 'transfer/version-unsupported',
  runningSession: 'transfer/running-session',
  notFound: 'transfer/not-found',
  unauthenticated: 'transfer/unauthenticated',
  unavailable: 'transfer/unavailable',
  invalidRequest: 'transfer/invalid-request',
  noHome: 'transfer/no-home',
  tooLarge: 'transfer/too-large',
  targetNotEmpty: 'transfer/target-not-empty',
  bindFailed: 'transfer/bind-failed',
  failed: 'transfer/failed',
  cancelled: 'transfer/cancelled',
})

export class TransferError extends Error {
  readonly code: string
  readonly details?: unknown
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'TransferError'
    this.code = code
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// 工作区文件排除表（P7）：内置安全基线，导入端不可被用户规则覆盖
// ---------------------------------------------------------------------------

/** 目录基线：命中任一路径段即排除。 */
export const BASE_EXCLUDE_DIRECTORIES = Object.freeze([
  'node_modules',
  '.git',
  'dist',
  '.workdsh-npm-cache',
  '.workdsh-pnpm-store',
])

/** 密钥/凭据类：glob 片段，命中文件名或路径即排除。 */
export const SECRET_EXCLUDE_PATTERNS = Object.freeze([
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.keystore',
  'id_rsa',
  'id_ed25519',
  '.ssh',
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'service-account*.json',
  '*.secret',
  '*secret*.json',
])

/** manifest 中记录的完整基线（目录 + 密钥类）。 */
export const BUILTIN_EXCLUDES: readonly string[] = Object.freeze([
  ...BASE_EXCLUDE_DIRECTORIES,
  ...SECRET_EXCLUDE_PATTERNS,
])

// ---------------------------------------------------------------------------
// 阈值（P8 暂定可配置默认值，实现方按实测定稿后回填）
// ---------------------------------------------------------------------------

export const LIMITS = Object.freeze({
  /** 单个工作区文件 */
  maxFileBytes: 64 * 1024 * 1024,
  /** 源文件总计 */
  maxSourceBytes: 1024 * 1024 * 1024,
  /** 文件数 */
  maxFileCount: 5000,
  /** 目录层级 */
  maxDepth: 32,
  /** 整包（含附件/会话） */
  maxArchiveBytes: 2 * 1024 * 1024 * 1024,
  /** 单次导入 ZIP 解压后的总字节（zip bomb 防护） */
  maxExpandedBytes: 4 * 1024 * 1024 * 1024,
  /** preview token 有效期（毫秒） */
  tokenTtlMs: 30 * 60 * 1000,
  /** 单个会话日志最大字节 */
  maxSessionLogBytes: 256 * 1024 * 1024,
})

// ---------------------------------------------------------------------------
// 其他
// ---------------------------------------------------------------------------

export const ZIP_FILENAME_PREFIX = 'session-transfer-'
export const MANIFEST_MEMBER = 'manifest.json'

/** 未归属于任何工作区的会话，在导出分组与导入映射中共用同一个虚拟 id。 */
export const UNASSIGNED_WORKSPACE_ID = '__unassigned__'
export const UNASSIGNED_WORKSPACE_TITLE = '未归属工作区'

/** 会话 id 白名单，与官方 SessionId 约定一致。 */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
/** 附件 id：官方为 sha256:<64hex>。 */
export const ATTACHMENT_ID = /^sha256:([a-f0-9]{64})$/u
