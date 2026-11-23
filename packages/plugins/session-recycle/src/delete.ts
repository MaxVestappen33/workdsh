import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 会话 id 的磁盘白名单：官方 id 由字母、数字、点和短横线组成，禁止任何路径分隔符。 */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

/** 官方会话快照里本删除流程需要的字段（`sessionPersistence.list()` 的子集）。 */
export interface SessionSnapshotLike {
  readonly header: {
    readonly id: string
    readonly parentSession?: string
    readonly origin?: 'subagent'
  }
}

/**
 * 计算级联删除集合：目标会话本身 + 其 parentSession 链上 `origin === 'subagent'` 的后代。
 * 分叉会话（同 parentSession 但非 subagent）不级联，也不沿它继续向下查找。
 */
export function subagentCascade(rootId: string, snapshots: readonly SessionSnapshotLike[]): string[] {
  const children = new Map<string, Array<SessionSnapshotLike['header']>>()
  for (const { header } of snapshots) {
    const parent = header.parentSession
    if (parent === undefined) continue
    const list = children.get(parent)
    if (list === undefined) children.set(parent, [header])
    else list.push(header)
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

/**
 * 在会话根目录的直接子目录（每个工作区一个）里定位该会话的目录。
 * 目录名就是会话 id；根目录不存在或会话尚未落盘时返回空数组。
 */
export async function locateSessionDirectories(root: string, id: string): Promise<string[]> {
  if (!SESSION_ID.test(id)) throw new Error(`Invalid session id: ${id}`)
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: string[] = []
  for (const project of projects) {
    if (!project.isDirectory() || project.name.startsWith('.')) continue
    const candidate = join(root, project.name, id)
    const info = await stat(candidate).catch(() => undefined)
    if (info?.isDirectory()) found.push(candidate)
  }
  return found.sort()
}

/** 递归统计一个会话目录的字节数，用于删除结果回执。 */
export async function directoryBytes(directory: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(path)
    else if (entry.isFile()) total += (await stat(path)).size
  }
  return total
}

/** 一条待删除的会话目录：源路径、回收站路径，以及预统计的字节数。 */
export interface StagedDirectory {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly bytes: number
}

export type Rename = (from: string, to: string) => Promise<void>

/**
 * 把整批会话目录移入回收站批次目录；先写清单再移动，任一步失败都整批移回原位。
 * 只有全部移动成功才返回，调用方随后用 `sessionPersistence.stat` 校验可见性。
 */
export async function stageDirectories(
  batchDirectory: string,
  entries: readonly StagedDirectory[],
  renameImpl: Rename = rename,
): Promise<void> {
  await mkdir(batchDirectory, { recursive: true })
  await writeFile(
    join(batchDirectory, 'manifest.json'),
    `${JSON.stringify({
      createdAt: new Date().toISOString(),
      entries: entries.map(({ id, from, to, bytes }) => ({ id, from, to, bytes })),
    }, null, 2)}\n`,
    { mode: 0o600 },
  )
  const moved: StagedDirectory[] = []
  try {
    for (const entry of entries) {
      await renameImpl(entry.from, entry.to)
      moved.push(entry)
    }
  } catch (error) {
    await rollbackDirectories(moved, renameImpl)
    await rm(batchDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

/** 逆序把已移动的目录移回原位；回滚本身失败只忽略，避免掩盖原始错误。 */
export async function rollbackDirectories(
  entries: readonly StagedDirectory[],
  renameImpl: Rename = rename,
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    await renameImpl(entry.to, entry.from).catch(() => undefined)
  }
}
