/**
 * 包内成员名 / 路径安全 / 平台中立处理。
 *
 * 纯函数，不依赖 node:path（Client 侧也可安全引用）。包内成员名一律 `/`
 * 分隔的 POSIX 风格相对路径；落盘时才由 Host 用 path 模块转成本机分隔符。
 * 禁止全局替换事件文本里的路径字符串（红线 2），这里只处理结构化路径值。
 */

/** Windows 文件名非法字符与控制字符。 */
const UNSAFE_CHAR = /[<>:"|?*\u0000-\u001f]/u
/** Windows 保留设备名（大小写不敏感，带或不带扩展名）。 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/iu

export interface MemberCheck {
  readonly safe: boolean
  readonly reason?: string
  /** 规范化后的成员名（统一 `/`、去掉前导 `./`） */
  readonly normalized: string
}

/**
 * 校验一个 ZIP 成员名（zip-slip 防护）。
 * 拒绝：绝对路径、盘符、反斜杠开头、`..` 段、空段、控制字符、Windows
 * 非法字符与保留名、`\` 分隔（要求生产者一律用 `/`）、超长路径。
 */
export function checkMember(name: string): MemberCheck {
  if (typeof name !== 'string' || name.length === 0) {
    return { safe: false, reason: 'empty', normalized: '' }
  }
  const raw = name
  if (raw.startsWith('/') || raw.startsWith('\\')) {
    return { safe: false, reason: 'absolute', normalized: '' }
  }
  if (/^[A-Za-z]:/u.test(raw)) {
    return { safe: false, reason: 'drive-letter', normalized: '' }
  }
  if (raw.includes('\\')) {
    return { safe: false, reason: 'backslash', normalized: '' }
  }
  if (UNSAFE_CHAR.test(raw)) {
    return { safe: false, reason: 'unsafe-char', normalized: '' }
  }
  if (raw.length > 4096) {
    return { safe: false, reason: 'too-long', normalized: '' }
  }
  const segments: string[] = []
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return { safe: false, reason: 'traversal', normalized: '' }
    if (WINDOWS_RESERVED.test(segment)) return { safe: false, reason: 'reserved-name', normalized: '' }
    if (/[.\s]$/u.test(segment)) return { safe: false, reason: 'trailing-dot-or-space', normalized: '' }
    segments.push(segment)
  }
  if (segments.length === 0) return { safe: false, reason: 'empty', normalized: '' }
  return { safe: true, normalized: segments.join('/') }
}

/**
 * Windows 资源管理器压缩会套一层 `<包名>/`。当且仅当所有成员共享同一个
 * 顶层目录时自动剥离，避免误判正常的多目录包。
 */
export function stripCommonWrapper(members: readonly string[]): { prefix: string; names: readonly string[] } {
  if (members.length === 0) return { prefix: '', names: [] }
  const first = members[0].split('/')[0]
  if (first === undefined || first === '' || !members.every((m) => m.startsWith(first + '/'))) {
    return { prefix: '', names: members }
  }
  return {
    prefix: first + '/',
    names: members.map((m) => m.slice(first.length + 1)),
  }
}

// ---------------------------------------------------------------------------
// 忽略规则
// ---------------------------------------------------------------------------

/** 把 glob 片段编译成正则；支持 `*` `?`，`**` 跨目录。 */
function compileGlob(pattern: string): RegExp {
  let body = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        body += '.*'
        i += 1
      } else {
        body += '[^/]*'
      }
    } else if (char === '?') {
      body += '[^/]'
    } else {
      body += char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    }
  }
  return new RegExp('^' + body + '$', 'iu')
}

const globCache = new Map<string, RegExp>()
function glob(pattern: string): RegExp {
  let value = globCache.get(pattern)
  if (value === undefined) {
    value = compileGlob(pattern)
    globCache.set(pattern, value)
  }
  return value
}

/** 目录基线：命中任一路径段即排除（大小写不敏感）。 */
export function isExcludedDirectory(relPath: string, directories: readonly string[]): boolean {
  const segments = relPath.split('/')
  return segments.some((segment) => directories.some((d) => d.toLowerCase() === segment.toLowerCase()))
}

/**
 * 用户/密钥 glob 规则：对整条相对路径、每个路径段、文件名三者任一命中即排除。
 * 规则末尾的 `/` 视为目录前缀。
 */
export function matchesExcludeRule(relPath: string, rule: string): boolean {
  const trimmed = rule.trim().replace(/\/$/u, '')
  if (trimmed === '') return false
  const segments = relPath.split('/')
  const filename = segments[segments.length - 1] ?? ''
  const re = glob(trimmed)
  if (re.test(relPath) || re.test(filename)) return true
  if (segments.some((s) => re.test(s))) return true
  // 目录规则：`**/node_modules/**` 或 `.ssh/` 之类
  if (glob(trimmed + '/**').test(relPath)) return true
  return false
}

export function isExcluded(relPath: string, directories: readonly string[], rules: readonly string[]): boolean {
  if (isExcludedDirectory(relPath, directories)) return true
  return rules.some((rule) => matchesExcludeRule(relPath, rule))
}

// ---------------------------------------------------------------------------
// 工作区相对路径
// ---------------------------------------------------------------------------

/** 规范化为 `/` 分隔、无前导 `./`、无 `..` 的相对路径；越界返回 undefined。 */
export function normalizeRelative(input: string): string | undefined {
  if (typeof input !== 'string') return undefined
  let value = input.replace(/\\/gu, '/')
  while (value.startsWith('./')) value = value.slice(2)
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value)) return undefined
  const out: string[] = []
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length === 0) return undefined
      out.pop()
      continue
    }
    if (UNSAFE_CHAR.test(segment) || WINDOWS_RESERVED.test(segment)) return undefined
    out.push(segment)
  }
  return out.length === 0 ? undefined : out.join('/')
}

/** 把绝对路径限定在 workspace root 之内，返回其相对路径；越界返回 undefined。 */
export function relativeToWorkspace(absolute: string, root: string): string | undefined {
  const normAbs = absolute.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const normRoot = root.replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (normAbs === normRoot) return undefined
  const prefix = normRoot + '/'
  if (!normAbs.toLowerCase().startsWith(prefix.toLowerCase())) return undefined
  return normalizeRelative(normAbs.slice(prefix.length))
}

/** 目录层级是否超限。 */
export function withinDepth(relPath: string, maxDepth: number): boolean {
  return relPath.split('/').length <= maxDepth
}

// ---------------------------------------------------------------------------
// cwd 改写（只改结构化字段，不改事件文本）
// ---------------------------------------------------------------------------

/**
 * 把 cwd 从「源工作区路径」改写为「本机目标工作区路径」。
 * - 以源路径为前缀 → 替换前缀，保留子目录（相对路径语义）。
 * - 相等 → 直接返回目标根。
 * - 不是源工作区内的路径（会话中途切到工作区外）→ 返回目标根，
 *   因为 attachSession 要求 header.cwd === workspace.path。
 */
export function rewriteCwd(cwd: string | undefined, sourcePath: string, targetPath: string): string {
  if (targetPath === '') return cwd ?? ''
  if (cwd === undefined || cwd === '') return targetPath
  const normCwd = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const normSource = sourcePath.replace(/\\/gu, '/').replace(/\/+$/u, '')
  if (normCwd.toLowerCase() === normSource.toLowerCase()) return targetPath
  const prefix = normSource + '/'
  if (normCwd.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rest = normCwd.slice(prefix.length)
    return targetPath.replace(/\/+$/u, '') + '/' + rest
  }
  return targetPath
}

/** 按 process.platform 生成「新建目录」默认路径（不硬编码用户名或盘符）。 */
export function defaultWorkspaceRoot(platform: string, homedir: string, title: string): string {
  const safeTitle = title.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').trim() || '新工作区'
  if (platform === 'win32') {
    return homedir.replace(/[\\/]+$/u, '') + '\\Documents\\' + safeTitle
  }
  if (platform === 'darwin') {
    return homedir.replace(/\/+$/u, '') + '/Documents/' + safeTitle
  }
  return homedir.replace(/\/+$/u, '') + '/Documents/' + safeTitle
}

/** 文件名安全化：用于「（导入）」标题后缀与包文件名。 */
export function safeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80) || 'session'
}

/** 生成导出包文件名：session-transfer-YYYYMMDD-HHmm.zip */
export function exportFilename(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `session-transfer-${stamp}.zip`
}

/** 生成包内会话日志成员名。 */
export function sessionLogMember(id: string): string {
  return `sessions/${safeFileSegment(id)}.jsonl`
}

/** 包内附件成员名（不沿用官方 media/sha256:<hex> 命名，冒号在 Windows 非法）。 */
export function attachmentMember(id: string, kind: 'image' | 'file'): string {
  const match = /^sha256:([a-f0-9]{64})$/u.exec(id)
  const digest = match?.[1] ?? safeFileSegment(id)
  const bucket = kind === 'image' ? 'objects' : 'file-objects'
  return `attachments/${bucket}/${digest.slice(0, 2)}/${digest}`
}
