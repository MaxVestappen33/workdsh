/**
 * 更新状态机：纯函数 reducer，不触碰网络、磁盘、Electron。
 * 副作用以 effect 列表返回，由服务层串行执行；因此可以在 headless 测试中跑全迁移矩阵。
 */
import type { UpdateCandidate } from './update-release.ts'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'

export type UpdateOperation = 'check' | 'download' | 'verify' | 'install'

/** 对外只暴露稳定枚举，具体错误文本由界面按本地化文案渲染。 */
export type UpdateFailureCode =
  | 'manifest-too-large'
  | 'manifest-invalid'
  | 'signature-unknown-key'
  | 'signature-invalid'
  | 'channel-mismatch'
  | 'platform-mismatch'
  | 'sequence-regression'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'size-mismatch'
  | 'hash-mismatch'
  | 'disk-insufficient'
  | 'url-not-allowed'
  | 'installer-invalid'
  | 'host-stop-failed'
  | 'installer-failed'
  // 与真实后台接口对接后新增：服务端错误、响应非法、写盘失败、平台不支持。
  | 'server-error'
  | 'invalid-response'
  | 'write-failed'
  | 'unsupported'

export interface UpdateFailure {
  readonly operation: UpdateOperation
  readonly code: UpdateFailureCode
}

/** 渲染层与托盘只读取这个快照；不包含 URL、路径或原始异常。 */
export interface UpdateSnapshot {
  readonly phase: UpdatePhase
  readonly candidate?: UpdateCandidate
  readonly percent?: number
  /** 当前检查是否由用户手动触发：决定失败是否可见。 */
  readonly manual?: boolean
  readonly failure?: UpdateFailure
}

export interface UpdateMachineState {
  readonly snapshot: UpdateSnapshot
  /** 最近一次检查完成（成功或失败）的时间戳，用于调度与提示节流。 */
  readonly lastCheckAt?: number
}

export type UpdateEffect =
  | { readonly type: 'check'; readonly manual: boolean }
  | { readonly type: 'download'; readonly candidate: UpdateCandidate }
  | { readonly type: 'verify'; readonly candidate: UpdateCandidate }
  | { readonly type: 'discard'; readonly version: string }
  | { readonly type: 'install'; readonly candidate: UpdateCandidate }

export type UpdateMachineEvent =
  | { readonly type: 'check'; readonly manual: boolean; readonly now: number }
  | { readonly type: 'checked'; readonly candidate?: UpdateCandidate; readonly now: number }
  | { readonly type: 'check-failed'; readonly code: UpdateFailureCode; readonly manual: boolean; readonly now: number }
  | { readonly type: 'download'; readonly version: string }
  | { readonly type: 'progress'; readonly percent: number }
  | { readonly type: 'downloaded' }
  | { readonly type: 'download-failed'; readonly code: UpdateFailureCode }
  | { readonly type: 'verified' }
  | { readonly type: 'verify-failed'; readonly code: UpdateFailureCode }
  | { readonly type: 'install'; readonly version: string }
  | { readonly type: 'install-failed'; readonly code: UpdateFailureCode }
  | { readonly type: 'cancel' }
  | { readonly type: 'dismiss' }
  | { readonly type: 'retry' }

export interface UpdateReduction {
  readonly state: UpdateMachineState
  readonly effects: readonly UpdateEffect[]
}

export function initialUpdateState(): UpdateMachineState {
  return { snapshot: { phase: 'idle' } }
}

/** 只有这三种状态允许发起新检查；下载/安装期间重复检查会打断用户预期。 */
function canCheck(phase: UpdatePhase): boolean {
  return phase === 'idle' || phase === 'available' || phase === 'error'
}

function unchanged(state: UpdateMachineState): UpdateReduction {
  return { state, effects: [] }
}

function failure(operation: UpdateOperation, code: UpdateFailureCode): UpdateFailure {
  return { operation, code }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.floor(value)))
}

/**
 * 状态机唯一入口。
 * 守卫失败时保持原状态且不产生副作用；调用方应把“被忽略”视为正常并发情况，而不是错误。
 */
export function reduceUpdate(state: UpdateMachineState, event: UpdateMachineEvent): UpdateReduction {
  const { snapshot } = state

  switch (event.type) {
    case 'check': {
      if (!canCheck(snapshot.phase)) return unchanged(state)
      return {
        state: {
          ...state,
          snapshot: { phase: 'checking', ...(event.manual ? { manual: true } : {}) },
        },
        effects: [{ type: 'check', manual: event.manual }],
      }
    }

    case 'checked': {
      if (snapshot.phase !== 'checking') return unchanged(state)
      if (event.candidate === undefined) {
        return { state: { snapshot: { phase: 'idle' }, lastCheckAt: event.now }, effects: [] }
      }
      return {
        state: {
          snapshot: { phase: 'available', candidate: event.candidate },
          lastCheckAt: event.now,
        },
        effects: [],
      }
    }

    case 'check-failed': {
      if (snapshot.phase !== 'checking') return unchanged(state)
      // 自动检查失败保持静默；手动检查失败才对用户可见。
      if (!event.manual) {
        return { state: { snapshot: { phase: 'idle' }, lastCheckAt: event.now }, effects: [] }
      }
      return {
        state: {
          snapshot: { phase: 'error', failure: failure('check', event.code), manual: true },
          lastCheckAt: event.now,
        },
        effects: [],
      }
    }

    case 'download': {
      const candidate = snapshot.candidate
      if (snapshot.phase !== 'available' || candidate === undefined || candidate.version !== event.version) {
        return unchanged(state)
      }
      return {
        state: { ...state, snapshot: { phase: 'downloading', candidate, percent: 0 } },
        effects: [{ type: 'download', candidate }],
      }
    }

    case 'progress': {
      const candidate = snapshot.candidate
      if (snapshot.phase !== 'downloading' || candidate === undefined) return unchanged(state)
      const percent = clampPercent(event.percent)
      if (percent === snapshot.percent) return unchanged(state)
      return {
        state: { ...state, snapshot: { phase: 'downloading', candidate, percent } },
        effects: [],
      }
    }

    case 'downloaded': {
      const candidate = snapshot.candidate
      if (snapshot.phase !== 'downloading' || candidate === undefined) return unchanged(state)
      return {
        state: { ...state, snapshot: { phase: 'verifying', candidate } },
        effects: [{ type: 'verify', candidate }],
      }
    }

    case 'download-failed': {
      if (snapshot.phase !== 'downloading') return unchanged(state)
      return {
        state: {
          ...state,
          snapshot: {
            phase: 'error',
            ...(snapshot.candidate === undefined ? {} : { candidate: snapshot.candidate }),
            failure: failure('download', event.code),
          },
        },
        effects: [],
      }
    }

    case 'verified': {
      const candidate = snapshot.candidate
      if (snapshot.phase !== 'verifying' || candidate === undefined) return unchanged(state)
      return {
        state: { ...state, snapshot: { phase: 'ready', candidate } },
        effects: [],
      }
    }

    case 'verify-failed': {
      if (snapshot.phase !== 'verifying') return unchanged(state)
      return {
        state: {
          ...state,
          snapshot: {
            phase: 'error',
            ...(snapshot.candidate === undefined ? {} : { candidate: snapshot.candidate }),
            failure: failure('verify', event.code),
          },
        },
        effects: [],
      }
    }

    case 'install': {
      const candidate = snapshot.candidate
      if (snapshot.phase !== 'ready' || candidate === undefined || candidate.version !== event.version) {
        return unchanged(state)
      }
      return {
        state: { ...state, snapshot: { phase: 'installing', candidate } },
        effects: [{ type: 'install', candidate }],
      }
    }

    case 'install-failed': {
      if (snapshot.phase !== 'installing') return unchanged(state)
      return {
        state: {
          ...state,
          snapshot: {
            phase: 'error',
            ...(snapshot.candidate === undefined ? {} : { candidate: snapshot.candidate }),
            failure: failure('install', event.code),
          },
        },
        effects: [],
      }
    }

    case 'cancel': {
      const candidate = snapshot.candidate
      if (snapshot.phase !== 'downloading' || candidate === undefined) return unchanged(state)
      return {
        state: { ...state, snapshot: { phase: 'available', candidate } },
        effects: [{ type: 'discard', version: candidate.version }],
      }
    }

    case 'dismiss': {
      if (snapshot.phase === 'available') {
        return { state: { snapshot: { phase: 'idle' }, ...(state.lastCheckAt === undefined ? {} : { lastCheckAt: state.lastCheckAt }) }, effects: [] }
      }
      // 已下载完成时只退回“可下载”提示，不删除已校验的包。
      if (snapshot.phase === 'ready' && snapshot.candidate !== undefined) {
        return { state: { ...state, snapshot: { phase: 'available', candidate: snapshot.candidate } }, effects: [] }
      }
      if (snapshot.phase === 'error') {
        return { state: { snapshot: { phase: 'idle' }, ...(state.lastCheckAt === undefined ? {} : { lastCheckAt: state.lastCheckAt }) }, effects: [] }
      }
      return unchanged(state)
    }

    case 'retry': {
      if (snapshot.phase !== 'error' || snapshot.failure === undefined) return unchanged(state)
      const candidate = snapshot.candidate
      switch (snapshot.failure.operation) {
        case 'check':
          return {
            state: { ...state, snapshot: { phase: 'checking', manual: true } },
            effects: [{ type: 'check', manual: true }],
          }
        case 'download':
        case 'verify':
          if (candidate === undefined) return { state: { snapshot: { phase: 'idle' } }, effects: [] }
          return {
            state: { ...state, snapshot: { phase: 'downloading', candidate, percent: 0 } },
            effects: [{ type: 'download', candidate }],
          }
        case 'install':
          // 安装失败后回到“就绪”，重新走一次用户确认，绝不自动重试安装。
          if (candidate === undefined) return { state: { snapshot: { phase: 'idle' } }, effects: [] }
          return { state: { ...state, snapshot: { phase: 'ready', candidate } }, effects: [] }
      }
    }
  }
}
