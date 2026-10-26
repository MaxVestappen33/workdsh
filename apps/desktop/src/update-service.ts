/**
 * 更新服务：把“检查接口、下载器、状态机、安装交接”串起来。
 * 状态迁移由纯 reducer 决定，这里只负责按顺序执行副作用并发布快照。
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { queryLatestVersion, type LatestVersionQueryFailure } from './update-client.ts'
import { downloadInstaller, type DownloadFailure } from './update-download.ts'
import { resolveCandidate, type UpdateCandidate } from './update-release.ts'
import {
  initialUpdateState,
  reduceUpdate,
  type UpdateEffect,
  type UpdateFailureCode,
  type UpdateMachineEvent,
  type UpdateMachineState,
  type UpdateSnapshot,
} from './update-state.ts'

export interface UpdateServiceOptions {
  readonly baseUrl: string
  readonly appId: string
  readonly platform: string
  readonly arch: string
  readonly currentVersion: string
  readonly latestVersionPath?: string
  /** 安装包暂存目录，通常是 userData/updates。 */
  readonly downloadDirectory: string
  readonly fetch?: typeof fetch
  readonly freeBytes?: (directory: string) => Promise<number>
  readonly onState?: (snapshot: UpdateSnapshot) => void
  /** 用户确认安装后调用；实现方负责停 Host、启动安装器并退出应用。 */
  readonly onInstall: (candidate: UpdateCandidate, installerPath: string) => Promise<void>
  readonly onJournal?: (event: string, detail?: string) => void
  /** 用户“稍后”过的版本；自动检查时不再重复提示，手动检查仍可见。 */
  readonly skippedVersion?: () => string | undefined
  readonly rememberSkipped?: (version: string) => void
  readonly now?: () => number
}

function queryFailureCode(reason: LatestVersionQueryFailure): UpdateFailureCode {
  switch (reason) {
    case 'timeout': return 'timeout'
    case 'network': return 'network'
    case 'server-error': return 'server-error'
    default: return 'invalid-response'
  }
}

function downloadFailureCode(failure: DownloadFailure): UpdateFailureCode {
  switch (failure) {
    case 'network': return 'network'
    case 'timeout': return 'timeout'
    case 'http-status': return 'server-error'
    case 'size-mismatch': return 'size-mismatch'
    case 'hash-mismatch': return 'hash-mismatch'
    case 'disk-insufficient': return 'disk-insufficient'
    case 'write-failed': return 'write-failed'
    case 'cancelled': return 'cancelled'
  }
}

export function installerPathFor(directory: string, version: string): string {
  return join(directory, 'app', version, 'setup.exe')
}

export class UpdateService {
  private state: UpdateMachineState = initialUpdateState()
  private queue: Promise<void> = Promise.resolve()
  private controller: AbortController | undefined
  private disposed = false

  constructor(private readonly options: UpdateServiceOptions) {}

  get snapshot(): UpdateSnapshot {
    return this.state.snapshot
  }

  /** 手动检查会打开更新窗口；自动检查失败保持静默。 */
  check(manual = false): Promise<void> {
    return this.enqueue({ type: 'check', manual, now: this.now() })
  }

  download(): Promise<void> {
    const candidate = this.state.snapshot.candidate
    if (candidate === undefined) return Promise.resolve()
    return this.enqueue({ type: 'download', version: candidate.version })
  }

  install(): Promise<void> {
    const candidate = this.state.snapshot.candidate
    if (candidate === undefined) return Promise.resolve()
    return this.enqueue({ type: 'install', version: candidate.version })
  }

  /**
   * 取消下载：直接中止当前传输，下载副作用会转为 cancel 事件。
   * 不在队列里排队，否则会等到下载结束才生效。
   */
  cancel(): Promise<void> {
    if (this.controller !== undefined) {
      this.controller.abort()
      return Promise.resolve()
    }
    return this.enqueue({ type: 'cancel' })
  }

  dismiss(): Promise<void> {
    const { snapshot } = this.state
    if (snapshot.phase === 'available' && snapshot.candidate !== undefined) {
      this.options.rememberSkipped?.(snapshot.candidate.version)
    }
    return this.enqueue({ type: 'dismiss' })
  }

  retry(): Promise<void> {
    return this.enqueue({ type: 'retry' })
  }

  dispose(): void {
    this.disposed = true
    this.controller?.abort()
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private enqueue(event: UpdateMachineEvent): Promise<void> {
    const run = this.queue.then(() => this.apply(event))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async apply(event: UpdateMachineEvent): Promise<void> {
    if (this.disposed) return
    const previous = this.state
    const reduction = reduceUpdate(previous, event)
    this.state = reduction.state
    if (this.state !== previous) this.publish()
    for (const effect of reduction.effects) {
      if (this.disposed) return
      await this.run(effect)
    }
  }

  private publish(): void {
    try {
      this.options.onState?.(this.state.snapshot)
    } catch {
      // 界面回调失败不影响更新流程。
    }
  }

  private journal(event: string, detail?: string): void {
    try {
      this.options.onJournal?.(event, detail)
    } catch {
      // 诊断日志失败不影响更新流程。
    }
  }

  private async run(effect: UpdateEffect): Promise<void> {
    switch (effect.type) {
      case 'check':
        return this.runCheck(effect.manual)
      case 'download':
        return this.runDownload(effect.candidate)
      case 'verify':
        // 下载器已在校验通过后才返回，这里只推进状态。
        await this.apply({ type: 'verified' })
        return
      case 'install':
        return this.runInstall(effect.candidate)
      case 'discard':
        await this.discard(effect.version)
        return
    }
  }

  private async runCheck(manual: boolean): Promise<void> {
    this.journal('check-started', manual ? 'manual' : 'automatic')
    const result = await queryLatestVersion({
      baseUrl: this.options.baseUrl,
      appId: this.options.appId,
      platform: this.options.platform,
      arch: this.options.arch,
      ...(this.options.latestVersionPath === undefined ? {} : { path: this.options.latestVersionPath }),
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
    })
    if (this.disposed) return

    if (!result.ok) {
      this.journal('check-failed', result.reason)
      await this.apply({ type: 'check-failed', code: queryFailureCode(result.reason), manual, now: this.now() })
      return
    }
    if (result.release === null) {
      this.journal('check-none')
      await this.apply({ type: 'checked', now: this.now() })
      return
    }

    const resolved = resolveCandidate(this.options.currentVersion, result.release)
    if (resolved === undefined) {
      this.journal('check-up-to-date', result.release.version)
      await this.apply({ type: 'checked', now: this.now() })
      return
    }

    // 用户主动点“稍后”的版本，自动检查不再打扰；手动检查仍然展示。
    const skipped = this.options.skippedVersion?.()
    if (!manual && !resolved.forced && skipped === resolved.candidate.version) {
      this.journal('check-skipped', resolved.candidate.version)
      await this.apply({ type: 'checked', now: this.now() })
      return
    }

    this.journal('check-available', resolved.candidate.version)
    await this.apply({ type: 'checked', candidate: resolved.candidate, now: this.now() })
  }

  private async runDownload(candidate: UpdateCandidate): Promise<void> {
    const destination = installerPathFor(this.options.downloadDirectory, candidate.version)
    const controller = new AbortController()
    this.controller = controller
    this.journal('download-started', candidate.version)
    const result = await downloadInstaller({
      url: candidate.downloadUrl,
      destination,
      size: candidate.size,
      sha256: candidate.sha256,
      signal: controller.signal,
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(this.options.freeBytes === undefined ? {} : { freeBytes: this.options.freeBytes }),
      onProgress: percent => {
        // 进度属于高频事件，直接推进状态，不经过任务队列。
        void this.apply({ type: 'progress', percent })
      },
    })
    this.controller = undefined
    if (this.disposed) return

    if (!result.ok) {
      if (result.failure === 'cancelled') {
        this.journal('download-cancelled', candidate.version)
        await this.apply({ type: 'cancel' })
        return
      }
      this.journal('download-failed', result.failure)
      await this.apply({ type: 'download-failed', code: downloadFailureCode(result.failure) })
      return
    }

    this.journal('download-completed', candidate.version)
    await this.apply({ type: 'downloaded' })
  }

  private async runInstall(candidate: UpdateCandidate): Promise<void> {
    const installerPath = installerPathFor(this.options.downloadDirectory, candidate.version)
    this.journal('install-started', candidate.version)
    try {
      await this.options.onInstall(candidate, installerPath)
    } catch (error) {
      this.journal('install-failed', error instanceof Error ? error.message : String(error))
      await this.apply({ type: 'install-failed', code: 'installer-failed' })
    }
  }

  private async discard(version: string): Promise<void> {
    const installer = installerPathFor(this.options.downloadDirectory, version)
    await Promise.all([
      rm(installer, { force: true }).catch(() => undefined),
      rm(`${installer}.part`, { force: true }).catch(() => undefined),
    ])
  }
}
