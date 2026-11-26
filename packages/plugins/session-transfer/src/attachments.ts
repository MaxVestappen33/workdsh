/**
 * 导入侧附件回写。
 *
 * 官方 @deepseek-ai/dsh-attachment-local 的内容寻址布局：
 *   DSH_HOME/attachments/v1/objects/<2>/<sha>              （image）
 *   DSH_HOME/attachments/v1/file-objects/<2>/<sha>         （file 规范对象）
 *   DSH_HOME/attachments/v1/files/<2>/<sha>/<name>         （file 展示名别名）
 * 包内成员名由 paths.attachmentMember 生成，恰好是去掉 `attachments/v1/` 前缀的同一布局，
 * 因此这里无需调用官方 saveImage/saveFileStream（那些方法还要重新归一化字节、会改变 sha），
 * 直接按 sha 校验后落盘即可与会话事件里的 `sha256:<hex>` 引用对齐。
 *
 * 安全：写前必须校验 sha256 与附件 id 完全一致、字节数与 manifest 一致；
 * 目标已存在则复用不覆盖；只把「本次真正创建」的路径记入 batch.writtenFiles 供回滚删除。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { ATTACHMENT_ID, LIMITS } from './constants.js'
import type { TransferManifestV2 } from './types.js'
import type { BatchRecord } from './jobs.js'
import type { ExtractResult } from './zip.js'
import { memberPath } from './zip.js'

export interface RestoreAttachmentsResult {
  /** 本次新建的对象数 */
  readonly restored: number
  /** 本机已有、直接复用的对象数 */
  readonly reused: number
  /** 校验失败 / 不合法的附件数 */
  readonly skipped: number
}

export async function restoreAttachments(
  manifest: TransferManifestV2,
  extract: ExtractResult,
  contentRoot: string,
  home: string,
  batch: BatchRecord,
  signal: AbortSignal,
): Promise<RestoreAttachmentsResult> {
  const root = join(home, 'attachments', 'v1')
  let restored = 0
  let reused = 0
  let skipped = 0

  for (const attachment of manifest.attachments) {
    signal.throwIfAborted()
    const match = ATTACHMENT_ID.exec(attachment.id)
    if (match === null) { skipped += 1; continue }
    const sha = match[1]
    const bucket = attachment.kind === 'image' ? 'objects' : 'file-objects'
    const target = join(root, bucket, sha.slice(0, 2), sha)

    let bytes: Buffer
    try {
      bytes = await readFile(memberPath(contentRoot, extract.wrapper, attachment.member))
    } catch {
      skipped += 1
      continue
    }
    if (bytes.byteLength !== attachment.bytes || bytes.byteLength > LIMITS.maxFileBytes) {
      skipped += 1
      continue
    }
    if (createHash('sha256').update(bytes).digest('hex') !== sha) {
      skipped += 1
      continue
    }

    // 官方对象是 immutable：已存在就复用，绝不覆盖（避免误删/篡改共享对象）。
    const existing = await stat(target).catch(() => undefined)
    if (existing !== undefined) { reused += 1; continue }

    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, bytes, { flag: 'wx', mode: 0o444 })
    } catch (error) {
      if (isExists(error)) { reused += 1; continue }
      skipped += 1
      continue
    }
    batch.writtenFiles.push(target)
    restored += 1

    // file 类型按展示名补一份别名，官方 storedFilePath 会按此读取。
    if (attachment.kind === 'file' && attachment.name !== undefined) {
      const name = basename(attachment.name.replace(/\\/gu, '/'))
      if (name !== '' && name !== '.' && name !== '..') {
        const alias = join(root, 'files', sha.slice(0, 2), sha, name)
        try {
          await mkdir(dirname(alias), { recursive: true, mode: 0o700 })
          await writeFile(alias, bytes, { flag: 'wx', mode: 0o444 })
          batch.writtenFiles.push(alias)
        } catch {
          // 别名已存在或写入失败都不影响主对象。
        }
      }
    }
  }

  return { restored, reused, skipped }
}

function isExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { code?: unknown }).code === 'EEXIST'
}
