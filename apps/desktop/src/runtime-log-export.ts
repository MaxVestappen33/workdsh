/**
 * 载体运行日志导出：收集 userData 下的运行日志、启动打点、Profile 证据与崩溃转储，
 * 脱敏后打成一个 ZIP。
 *
 * 与「诊断包」（`workdsh-plugin-diagnostics`）的分工：
 * - 诊断包由 Host 提供，围绕单个会话，必须已经进入工作台；
 * - 本模块由 Electron 载体执行，不依赖 Host，用于排查「整个软件」的运行错误，
 *   包括还没进入主页面就失败的情况。
 *
 * 不导入 electron，便于单测；所有路径由调用方传入。
 */
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { redactRuntimeLogText } from './runtime-diagnostics.ts'

/** 凭据类文件：永不出包，即便出现在日志目录里。 */
export const CREDENTIAL_FILE = /^(?:account-session\.bin|account-auth\.json|enterprise-auth\.json|Cookies|Local State)$/u
/** Profile 组合证据：版本、插件清单、实际生效的补丁。 */
const PROFILE_FILES = ['package.json', 'cordis.patch.yml', 'cordis.yml', 'compatibility.json'] as const
/** 单个文件上限：超过时跳过并在 manifest 里标注，避免一次导出被一个超大文件拖住。 */
const MAX_FILE_BYTES = 64 * 1024 * 1024
/** 整个包的上限：日志按天截断后通常远小于这个值，崩溃转储可能较大。 */
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024
/** 崩溃转储最多收集的文件数（按修改时间从新到旧）。 */
const MAX_CRASH_FILES = 40
/** 优先按二进制处理的扩展名；其余按 UTF-8 文本脱敏。 */
const BINARY_EXT = /\.(?:dmp|dat|bin|gz|zip|png|jpe?g|webp|ico|pdf|db|sqlite|node)$/iu

export type RuntimeLogSkipReason = 'credential' | 'too-large' | 'budget'

export interface RuntimeLogFile {
  /** ZIP 内路径，统一使用 `/`。 */
  archivePath: string
  /** 本机绝对路径。 */
  source: string
  bytes: number
  binary: boolean
}

export interface RuntimeLogSkipped {
  source: string
  bytes: number
  reason: RuntimeLogSkipReason
}

export interface RuntimeLogPlan {
  files: RuntimeLogFile[]
  skipped: RuntimeLogSkipped[]
  totalBytes: number
}

export interface RuntimeLogSources {
  /** `userData/logs`：Host 原始输出、载体日志、启动失败记录、更新日志等。 */
  logDirectory: string
  /** `userData`：`startup-timing.log`、Chromium 日志等直接位于这里。 */
  userDataDirectory: string
  /** 当前生效的 Profile 目录（`.../profiles/workdsh`），可选。 */
  profileDirectory?: string | undefined
  /** Electron 的 crashDumps 目录，可选。 */
  crashDumpDirectory?: string | undefined
  maxTotalBytes?: number | undefined
}

const sizeOf = (path: string): number => {
  try {
    return Math.max(0, statSync(path).size)
  } catch {
    return 0
  }
}

const isBinary = (path: string): boolean => BINARY_EXT.test(extname(path))

/**
 * 枚举运行日志包里的文件。顺序即优先级：日志目录 → 启动打点 → Chromium 日志 →
 * Profile 证据 → 崩溃转储。总量预算用完后，后面的文件只记录跳过原因，不再入包。
 */
export function planRuntimeLogs(input: RuntimeLogSources): RuntimeLogPlan {
  const maxTotalBytes = input.maxTotalBytes ?? MAX_TOTAL_BYTES
  const files: RuntimeLogFile[] = []
  const skipped: RuntimeLogSkipped[] = []
  const seen = new Set<string>()
  let totalBytes = 0

  const add = (source: string, archivePath: string, forceBinary = false): void => {
    if (seen.has(source)) return
    let info: ReturnType<typeof statSync>
    try {
      info = statSync(source)
    } catch {
      return
    }
    if (!info.isFile()) return
    const bytes = Math.max(0, info.size)
    if (bytes > MAX_FILE_BYTES) { skipped.push({ source, bytes, reason: 'too-large' }); return }
    if (totalBytes + bytes > maxTotalBytes) { skipped.push({ source, bytes, reason: 'budget' }); return }
    seen.add(source)
    totalBytes += bytes
    files.push({ archivePath, source, bytes, binary: forceBinary || isBinary(source) })
  }

  if (existsSync(input.logDirectory)) {
    let names: string[] = []
    try { names = readdirSync(input.logDirectory).sort() } catch { names = [] }
    for (const name of names) {
      if (CREDENTIAL_FILE.test(name)) {
        skipped.push({ source: join(input.logDirectory, name), bytes: sizeOf(join(input.logDirectory, name)), reason: 'credential' })
        continue
      }
      add(join(input.logDirectory, name), `logs/${name}`)
    }
  }

  add(join(input.userDataDirectory, 'startup-timing.log'), 'startup-timing.log')
  add(join(input.userDataDirectory, 'logs', 'chromium.log'), 'logs/chromium.log')

  if (input.profileDirectory !== undefined) {
    for (const name of PROFILE_FILES) add(join(input.profileDirectory, name), `profile/${name}`)
  }

  if (input.crashDumpDirectory !== undefined) collectCrashDumps(input.crashDumpDirectory, add)

  return { files, skipped, totalBytes }
}

/** 崩溃转储按修改时间从新到旧，最多收集固定份数。 */
function collectCrashDumps(directory: string, add: (source: string, archivePath: string, forceBinary?: boolean) => void): void {
  const found: { path: string, mtime: number }[] = []
  const walk = (current: string, depth: number): void => {
    if (depth > 4 || found.length >= MAX_CRASH_FILES * 4) return
    let entries: Dirent[]
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) { walk(path, depth + 1); continue }
      if (!entry.isFile()) continue
      try { found.push({ path, mtime: statSync(path).mtimeMs }) } catch { /* 忽略读取失败 */ }
    }
  }
  walk(directory, 0)
  found.sort((left, right) => right.mtime - left.mtime)
  for (const item of found.slice(0, MAX_CRASH_FILES)) {
    const name = relative(directory, item.path).split('\\').join('/')
    // 崩溃转储目录里可能有没有扩展名的二进制文件，统一按二进制原样保留。
    add(item.path, `crash-dumps/${name}`, true)
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntry { path: string, data: Buffer }

/** 最小 ZIP 写入器：deflate + UTF-8 文件名，不引入运行时依赖。 */
export function buildZip(entries: ZipEntry[], now = new Date()): Buffer {
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((Math.floor(now.getSeconds() / 2)) & 0x1f)
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 6 })
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, compressed)
    centrals.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDirectory, end])
}

export interface RuntimeLogBundle {
  data: Buffer
  plan: RuntimeLogPlan
  missing: string[]
  manifest: Record<string, unknown>
}

/**
 * 读取、脱敏并打包。单个文件读失败只记入 `missing`，不影响其余文件。
 */
export function buildRuntimeLogBundle(
  input: RuntimeLogSources & { metadata?: Record<string, unknown> | undefined, now?: Date | undefined },
): RuntimeLogBundle {
  const plan = planRuntimeLogs(input)
  const now = input.now ?? new Date()
  const missing: string[] = []
  const entries: ZipEntry[] = []
  for (const file of plan.files) {
    try {
      const raw = readFileSync(file.source)
      const data = file.binary ? raw : Buffer.from(redactRuntimeLogText(raw.toString('utf8')), 'utf8')
      entries.push({ path: file.archivePath, data })
    } catch {
      missing.push(file.source)
    }
  }
  const manifest: Record<string, unknown> = {
    generatedAt: now.toISOString(),
    product: 'PoliceAssistant',
    purpose: '软件整体运行日志（与单个会话的诊断包区分）',
    ...(input.metadata ?? {}),
    files: plan.files.map(file => ({ path: file.archivePath, bytes: file.bytes, binary: file.binary })),
    skipped: plan.skipped,
    missing,
  }
  entries.push({ path: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') })
  entries.push({ path: 'README-运行日志说明.txt', data: Buffer.from(runtimeLogReadme(now, plan), 'utf8') })
  return { data: buildZip(entries, now), plan, missing, manifest }
}

/** 包内说明：告诉现场人员先看哪些文件，以及软件完全打不开时还能去哪找证据。 */
export function runtimeLogReadme(now: Date, plan: RuntimeLogPlan): string {
  return [
    '警务助手 运行日志',
    `生成时间：${now.toISOString()}`,
    '',
    '这个压缩包用于排查「软件整体」的运行问题，不是单个会话的诊断包。',
    '',
    '建议优先查看：',
    '  logs/carrier-*.log            载体进程错误、错误弹窗内容、渲染进程/GPU 崩溃、页面加载失败',
    '  logs/host-output-*.log        DSH 本机进程的原始输出（插件报错的真实原因）',
    '  logs/runtime-failure*.log     启动失败、端口占用、运行中崩溃的现场记录',
    '  logs/update*.log              在线更新失败原因',
    '  startup-timing.log            启动各阶段耗时，判断卡在哪一步',
    '  logs/chromium.log             Chromium/GPU/渲染器告警与错误',
    '  crash-dumps/                  崩溃转储（如有）',
    '  manifest.json                 版本、系统、路径与文件清单',
    '',
    `本次收集 ${plan.files.length} 个文件，约 ${Math.round(plan.totalBytes / 1024)} KB。`,
    ...(plan.skipped.length ? ['', '以下文件因体积或凭据原因未收集：', ...plan.skipped.map(item => `  ${item.reason}: ${item.source}`)] : []),
    '',
    '如果软件完全无法启动、本包也无法导出：',
    '  Windows：%APPDATA%\\PoliceAssistant\\logs，或「事件查看器 → Windows 日志 → 应用程序」',
    '  macOS：~/Library/Application Support/PoliceAssistant/logs，或 ~/Library/Logs/DiagnosticReports',
    '  下次能正常进入软件后，日志仍在保留期内，可直接从菜单或账号菜单导出。',
    '',
    '日志中的 token、key、密码等凭据已脱敏；凭据文件与 dsh-home 下的会话正文不会进入本包。',
    '',
  ].join('\n')
}
