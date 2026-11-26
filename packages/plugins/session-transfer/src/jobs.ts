/**
 * 导入/导出任务表（内存态）。
 *
 * 仓库里没有现成的 token / job / status / cancel 服务，故按 §5 自建：
 * - preview 解包到 DSH_HOME/.workdsh-transfer/<token>/，apply 复用，避免二次上传
 * - apply 立即返回 batchId，前端轮询 status
 * - cancel 通过 AbortController 停止后续并触发回滚
 *
 * Desktop 单进程，重启后任务丢失是可接受的（见 README 已知风险）。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { LIMITS } from './constants.js'
import type { JobPhase, JobStatus, TransferManifestV2 } from './types.js'
import type { ExtractResult } from './zip.js'

export interface PreviewRecord {
  readonly token: string
  readonly createdAt: number
  readonly directory: string
  readonly archivePath: string
  readonly extract: ExtractResult
  readonly manifest: TransferManifestV2
  readonly logTexts: ReadonlyMap<string, string>
}

export interface BatchRecord {
  readonly batchId: string
  readonly createdAt: number
  readonly controller: AbortController
  status: JobStatus
  /** 已创建的会话 id（回滚时逆序清理） */
  readonly createdSessionIds: string[]
  /** 本次注册的工作区 id */
  readonly registeredWorkspaceIds: string[]
  /** 本次新建的目录 */
  readonly createdDirectories: string[]
  /** 临时目录 */
  readonly tempDirectories: string[]
  /** 本次真正新建的文件（工作区源文件 + 附件对象/别名），回滚时逐个删除 */
  readonly writtenFiles: string[]
  /** 待绑定（批次末统一执行，P18） */
  pendingBindSessionIds: string[]
}

export class JobStore {
  private readonly previews = new Map<string, PreviewRecord>()
  private readonly batches = new Map<string, BatchRecord>()
  private readonly exports = new Map<string, JobStatus>()
  private readonly root: string

  constructor(home: string) {
    this.root = join(home, '.workdsh-transfer')
  }

  get transferRoot(): string {
    return this.root
  }

  /** 创建 preview 临时目录。 */
  async createPreviewDirectory(): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    return mkdtemp(join(this.root, 'preview-'))
  }

  putPreview(record: Omit<PreviewRecord, 'token' | 'createdAt'> & { token?: string }): PreviewRecord {
    const full: PreviewRecord = {
      ...record,
      token: record.token ?? randomUUID(),
      createdAt: Date.now(),
    }
    this.previews.set(full.token, full)
    return full
  }

  /** 取 preview；过期自动清理并返回 undefined。 */
  takePreview(token: string): PreviewRecord | undefined {
    const record = this.previews.get(token)
    if (record === undefined) return undefined
    if (Date.now() - record.createdAt > LIMITS.tokenTtlMs) {
      void this.dropPreview(token)
      return undefined
    }
    return record
  }

  async dropPreview(token: string): Promise<void> {
    const record = this.previews.get(token)
    this.previews.delete(token)
    if (record !== undefined) await rm(record.directory, { recursive: true, force: true }).catch(() => undefined)
  }

  createBatch(total: number): BatchRecord {
    const batchId = randomUUID()
    const record: BatchRecord = {
      batchId,
      createdAt: Date.now(),
      controller: new AbortController(),
      status: { phase: 'validate', percent: 0, done: 0, total, current: '准备中', cancellable: true, state: 'running' },
      createdSessionIds: [],
      registeredWorkspaceIds: [],
      createdDirectories: [],
      tempDirectories: [],
      writtenFiles: [],
      pendingBindSessionIds: [],
    }
    this.batches.set(batchId, record)
    return record
  }

  getBatch(batchId: string): BatchRecord | undefined {
    return this.batches.get(batchId)
  }

  /** 更新进度。 */
  update(batch: BatchRecord, patch: Partial<Pick<JobStatus, 'phase' | 'percent' | 'done' | 'current' | 'cancellable' | 'state' | 'result' | 'warning' | 'error'>>): void {
    batch.status = { ...batch.status, ...patch }
  }

  setPhase(batch: BatchRecord, phase: JobPhase, current: string, percent: number): void {
    this.update(batch, { phase, current, percent })
  }

  createExport(): { jobId: string; status: JobStatus } {
    const jobId = randomUUID()
    const status: JobStatus = { phase: 'validate', percent: 0, done: 0, total: 0, current: '准备中', cancellable: false, state: 'running' }
    this.exports.set(jobId, status)
    return { jobId, status }
  }

  getExport(jobId: string): JobStatus | undefined {
    return this.exports.get(jobId)
  }

  setExport(jobId: string, status: JobStatus): void {
    this.exports.set(jobId, status)
  }

  /** 请求取消：返回 true 表示已发出中止信号，由执行体负责回滚；重复调用返回 false。 */
  requestCancel(batchId: string): boolean {
    const batch = this.batches.get(batchId)
    if (batch === undefined || batch.status.state !== 'running' || batch.controller.signal.aborted) return false
    batch.controller.abort()
    this.update(batch, { cancellable: false, current: '正在回滚…' })
    return true
  }

  /** 定期清理过期 preview 与已结束的批次，避免内存无限增长。 */
  sweep(): void {
    const now = Date.now()
    for (const [token, record] of this.previews) {
      if (now - record.createdAt > LIMITS.tokenTtlMs) void this.dropPreview(token)
    }
    for (const [id, batch] of this.batches) {
      if (batch.status.state !== 'running' && now - batch.createdAt > LIMITS.tokenTtlMs) {
        this.batches.delete(id)
      }
    }
    for (const [id, status] of this.exports) {
      if (status.state !== 'running') this.exports.delete(id)
    }
  }
}

/** 计算进度百分比，单调不回退。 */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(99, Math.round((done / total) * 100))
}
