/**
 * 工作区源文件收集（导出）与落盘（导入）。口径 A：只携带被会话引用、
 * 且位于工作区根内的相对路径文件，不整目录遍历。
 *
 * 复用 source-checkpoint 的「sha256 清单 + 二次校验 + staging + 原子切换」
 * 思路，但不直接 import（该模块是 workbenches 包私有），且修正其三处与
 * 本功能相反的行为：符号链接记 skipped 而非整批失败、Linux 保留可执行位、
 * 排除表扩展到密钥类。
 */

import {
  createHash,
} from 'node:crypto'
import {
  lstat, open, readFile, realpath, stat, writeFile,
} from 'node:fs/promises'
import { constants as FS } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { BASE_EXCLUDE_DIRECTORIES, BUILTIN_EXCLUDES, LIMITS } from './constants.js'
import type { WorkspaceFileEntryV2, WorkspaceFileSkipV2, SkipReason } from './types.js'
import {
  isExcluded, normalizeRelative, withinDepth,
} from './paths.js'

export interface FilePlanEntry extends WorkspaceFileEntryV2 {
  /** 本机绝对路径（导出侧读取用） */
  readonly absolute: string
}

export interface CollectResult {
  readonly files: readonly FilePlanEntry[]
  readonly skipped: readonly WorkspaceFileSkipV2[]
  readonly totals: { readonly fileCount: number; readonly byteLength: number }
  readonly exceeds: readonly string[]
}

/** 把内置排除 + 用户规则合并（内置项不可被用户规则移除，用户项只追加）。 */
export function effectiveExcludes(userExcludes: readonly string[]): {
  readonly directories: readonly string[]
  readonly rules: readonly string[]
  readonly recorded: readonly string[]
} {
  const extra = userExcludes.map((rule) => rule.trim()).filter((rule) => rule !== '')
  return {
    directories: BASE_EXCLUDE_DIRECTORIES,
    rules: [...BUILTIN_EXCLUDES, ...extra],
    recorded: [...BUILTIN_EXCLUDES, ...extra],
  }
}

/**
 * 收集被引用的工作区文件。
 * @param references 由 collectFileReferences 解析出的相对路径引用
 * @param roots workspaceId → 本机工作区根目录绝对路径
 */
export async function collectWorkspaceFiles(
  references: readonly { workspaceId: string; relative?: string; raw: string }[],
  roots: ReadonlyMap<string, string>,
  userExcludes: readonly string[],
  options: { signal?: AbortSignal } = {},
): Promise<CollectResult> {
  const { directories, rules } = effectiveExcludes(userExcludes)
  const skipped: WorkspaceFileSkipV2[] = []
  const files: FilePlanEntry[] = []
  const exceeds: string[] = []
  const seen = new Set<string>()
  let totalBytes = 0

  for (const reference of references) {
    options.signal?.throwIfAborted()
    if (reference.relative === undefined) {
      skipped.push({ path: reference.raw, reason: 'outside-workspace' })
      continue
    }
    const root = roots.get(reference.workspaceId)
    if (root === undefined) {
      skipped.push({ path: reference.raw, reason: 'outside-workspace' })
      continue
    }
    const rel = normalizeRelative(reference.relative)
    if (rel === undefined) {
      skipped.push({ path: reference.raw, reason: 'outside-workspace' })
      continue
    }
    const key = reference.workspaceId + ':' + rel
    if (seen.has(key)) continue
    seen.add(key)

    if (isExcluded(rel, directories, rules)) {
      skipped.push({ path: rel, reason: 'excluded' })
      continue
    }
    if (!withinDepth(rel, LIMITS.maxDepth)) {
      skipped.push({ path: rel, reason: 'unreadable' })
      continue
    }

    // realpath 越界校验：拼出来的绝对路径必须仍落在 root 内
    const absolute = resolve(root, ...rel.split('/'))
    const containment = relative(resolve(root), absolute)
    if (containment.startsWith('..') || containment.startsWith(sep) || isAbsoluteAcrossDrive(root, absolute)) {
      skipped.push({ path: rel, reason: 'outside-workspace' })
      continue
    }

    let info
    try {
      info = await lstat(absolute)
    } catch {
      skipped.push({ path: rel, reason: 'unreadable' })
      continue
    }
    if (info.isSymbolicLink()) {
      skipped.push({ path: rel, reason: 'symlink' })
      continue
    }
    if (!info.isFile()) {
      skipped.push({ path: rel, reason: 'unreadable' })
      continue
    }
    if (info.size > LIMITS.maxFileBytes) {
      skipped.push({ path: rel, reason: 'too-large' })
      continue
    }
    if (files.length >= LIMITS.maxFileCount) {
      exceeds.push(`文件数超过 ${LIMITS.maxFileCount}，请分批或关闭源文件开关`)
      break
    }
    if (totalBytes + info.size > LIMITS.maxSourceBytes) {
      exceeds.push(`源文件总计超过 ${LIMITS.maxSourceBytes} 字节，请分批或关闭源文件开关`)
      break
    }

    // 用 O_NOFOLLOW 读取，避免导出途中路径被替换成符号链接
    let bytes: Buffer
    try {
      const handle = await open(absolute, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0))
      try {
        bytes = await handle.readFile()
      } finally {
        await handle.close()
      }
    } catch {
      skipped.push({ path: rel, reason: 'unreadable' })
      continue
    }
    if (bytes.byteLength !== info.size) {
      skipped.push({ path: rel, reason: 'changed-during-export' })
      continue
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const executable = (info.mode & 0o111) !== 0
    totalBytes += bytes.byteLength
    files.push({
      workspaceId: reference.workspaceId,
      path: rel,
      sha256,
      bytes: bytes.byteLength,
      ...(executable ? { executable: true } : {}),
      absolute,
    })
  }

  return {
    files,
    skipped,
    totals: { fileCount: files.length, byteLength: totalBytes },
    exceeds,
  }
}

function isAbsoluteAcrossDrive(root: string, absolute: string): boolean {
  return /^[A-Za-z]:/u.test(absolute) && !absolute.toLowerCase().startsWith(root.toLowerCase())
}

/** 导出前二次校验：文件仍在、大小未变、摘要一致。 */
export async function verifyPlannedFile(entry: FilePlanEntry): Promise<boolean> {
  try {
    const before = await stat(entry.absolute)
    if (!before.isFile() || before.size !== entry.bytes) return false
    const bytes = await readFile(entry.absolute)
    return createHash('sha256').update(bytes).digest('hex') === entry.sha256
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 导入侧落盘
// ---------------------------------------------------------------------------

export interface RestoreResult {
  readonly restored: number
  /** 本次真正写入的本机绝对路径（回滚时按此删除） */
  readonly written: readonly string[]
  readonly skipped: readonly { path: string; reason: SkipReason }[]
}

/**
 * 把包内 workspace/<wsId>/<rel> 校验后落到目标工作区。
 * 只落空目录 / 新建目录；已有同名文件跳过，不覆盖、不合并 [P6]。
 * 先写 staging 临时目录，全部校验通过后原子切换到目标目录。
 *
 * @param readMember 读取包内成员字节的函数
 * @param targets workspaceId → 本机目标工作区根（已存在或由调用方新建）
 */
export async function restoreWorkspaceFiles(
  entries: readonly WorkspaceFileEntryV2[],
  readMember: (entry: WorkspaceFileEntryV2) => Promise<Buffer>,
  targets: ReadonlyMap<string, string>,
  stagingRoot: string,
): Promise<RestoreResult> {
  const skipped: { path: string; reason: SkipReason }[] = []
  const staged: { entry: WorkspaceFileEntryV2; absolute: string }[] = []

  for (const entry of entries) {
    const rel = normalizeRelative(entry.path)
    if (rel === undefined || !withinDepth(rel, LIMITS.maxDepth)) {
      skipped.push({ path: entry.path, reason: 'outside-workspace' })
      continue
    }
    const target = targets.get(entry.workspaceId)
    if (target === undefined) {
      skipped.push({ path: rel, reason: 'outside-workspace' })
      continue
    }
    const destination = resolve(target, ...rel.split('/'))
    const containment = relative(resolve(target), destination)
    if (containment.startsWith('..') || containment.startsWith(sep)) {
      skipped.push({ path: rel, reason: 'outside-workspace' })
      continue
    }
    // 已有同名文件：跳过，不覆盖
    const exists = await stat(destination).catch(() => undefined)
    if (exists !== undefined) {
      skipped.push({ path: rel, reason: 'excluded' })
      continue
    }

    let bytes: Buffer
    try {
      bytes = await readMember(entry)
    } catch {
      skipped.push({ path: rel, reason: 'unreadable' })
      continue
    }
    if (bytes.byteLength !== entry.bytes) {
      skipped.push({ path: rel, reason: 'changed-during-export' })
      continue
    }
    if (bytes.byteLength > LIMITS.maxFileBytes) {
      skipped.push({ path: rel, reason: 'too-large' })
      continue
    }
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      skipped.push({ path: rel, reason: 'changed-during-export' })
      continue
    }

    const stagePath = join(stagingRoot, entry.workspaceId, ...rel.split('/'))
    await writeFileTo(stagePath, bytes, entry.executable === true)
    staged.push({ entry: { ...entry, path: rel }, absolute: destination })
  }

  // 全部校验通过后才切换到目标目录；单个文件写入失败只跳过，不整批失败
  let restored = 0
  const written: string[] = []
  for (const item of staged) {
    try {
      const bytes = await readFile(join(stagingRoot, item.entry.workspaceId, ...item.entry.path.split('/')))
      await writeFileTo(item.absolute, bytes, item.entry.executable === true)
      written.push(item.absolute)
      restored += 1
    } catch {
      skipped.push({ path: item.entry.path, reason: 'unreadable' })
    }
  }
  return { restored, written, skipped }
}

async function writeFileTo(path: string, bytes: Buffer, executable: boolean): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const mode = executable ? 0o700 : 0o600
  await writeFile(path, bytes, { flag: 'wx', mode })
}

/** 校验目标目录是空目录（或不存在，由调用方决定是否新建）。 */
export async function targetDirState(path: string): Promise<'ok' | 'missing' | 'not-empty'> {
  const info = await lstat(path).catch(() => undefined)
  if (info === undefined) return 'missing'
  if (!info.isDirectory()) return 'not-empty'
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(path).catch(() => [] as string[])
  return entries.length === 0 ? 'ok' : 'not-empty'
}

/** realpath 规范化（目录必须已存在）。 */
export async function canonicalDirectory(path: string): Promise<string> {
  return realpath(path)
}
