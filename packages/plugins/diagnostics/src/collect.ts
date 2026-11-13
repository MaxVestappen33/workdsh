import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 诊断日志只收最近 24 小时：现场排查窗口固定，避免包体随使用时长膨胀。 */
export const WINDOW_MS = 24 * 60 * 60 * 1000

/** 载体与 Host 写入的按日滚动日志。 */
const DATED_LOG = /^(?:host-output|host-http|update|process-cleanup)-\d{4}-\d{2}-\d{2}\.log$/
/** 启动失败记录（含按尝试编号的 retry 文件），不带日期。 */
const RUNTIME_FAILURE = /^runtime-failure(?:-retry-\d+)?\.log$/
/** 凭据类文件：永不出包，即便出现在日志目录里。 */
export const CREDENTIAL_FILE = /^(?:account-session\.bin|account-auth\.json|Cookies|Local State)$/
/** Profile 组合证据：版本、插件清单、实际生效的补丁。 */
const PROFILE_FILES = ['package.json', 'cordis.patch.yml', 'cordis.yml', 'compatibility.json'] as const

export interface DiagnosticFile {
  /** ZIP 内路径。 */
  archivePath: string
  /** 本机绝对路径。 */
  source: string
  bytes: number
}

export interface DiagnosticsPlan {
  files: DiagnosticFile[]
  totalBytes: number
}

const sizeOf = (path: string): number => {
  try {
    return Math.max(0, statSync(path).size)
  } catch {
    return 0
  }
}

/**
 * 枚举诊断包里的自有文件：日志目录内 24 小时窗口内的滚动日志与启动失败记录，
 * 加上 Profile 组合证据。凭据文件与目录外文件一律不进入名单。
 */
export function planDiagnostics(input: {
  logDirectory: string | undefined
  profileDirectory: string | undefined
  now?: number
}): DiagnosticsPlan {
  const now = input.now ?? Date.now()
  const files: DiagnosticFile[] = []
  if (input.logDirectory && existsSync(input.logDirectory)) {
    const names = readdirSync(input.logDirectory).sort()
    for (const name of names) {
      if (CREDENTIAL_FILE.test(name)) continue
      if (!DATED_LOG.test(name) && !RUNTIME_FAILURE.test(name)) continue
      const source = join(input.logDirectory, name)
      let mtime: number
      try {
        const info = statSync(source)
        if (!info.isFile()) continue
        mtime = info.mtimeMs
      } catch {
        continue
      }
      if (now - mtime > WINDOW_MS) continue
      files.push({ archivePath: `diagnostics/logs/${name}`, source, bytes: sizeOf(source) })
    }
  }
  if (input.profileDirectory && existsSync(input.profileDirectory)) {
    for (const name of PROFILE_FILES) {
      const source = join(input.profileDirectory, name)
      if (!existsSync(source)) continue
      files.push({ archivePath: `diagnostics/profile/${name}`, source, bytes: sizeOf(source) })
    }
  }
  return { files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) }
}
