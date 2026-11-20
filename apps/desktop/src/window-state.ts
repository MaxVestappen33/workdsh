/**
 * 主窗口状态的持久化：记录退出前的位置、尺寸与最大化状态，下次启动时恢复。
 * 只做纯数据校验与读写，不依赖 Electron；显示器归属由调用方按工作区矩形传入。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WindowState {
  readonly bounds: WindowBounds
  /** 退出前是否最大化；恢复时按普通尺寸建窗再最大化，用户点「还原」才能回到原来的大小。 */
  readonly maximized: boolean
}

export const WINDOW_STATE_FILENAME = 'window-state.json'
/** 与 BrowserWindow 的 minWidth/minHeight 保持一致，避免恢复出比最小尺寸更小的窗口。 */
export const MIN_WINDOW_WIDTH = 960
export const MIN_WINDOW_HEIGHT = 640
/** 没有保存记录时的窗口普通尺寸（最大化前的还原尺寸）。 */
export const DEFAULT_WINDOW_WIDTH = 1440
export const DEFAULT_WINDOW_HEIGHT = 960

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseBounds(value: unknown): WindowBounds | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.width) || !isFiniteNumber(raw.height)) return undefined
  return { x: Math.round(raw.x), y: Math.round(raw.y), width: Math.round(raw.width), height: Math.round(raw.height) }
}

/** 读取上次退出时的窗口状态；文件缺失或内容不合法都返回 undefined，绝不阻断启动。 */
export function readWindowState(directory: string): WindowState | undefined {
  try {
    const file = join(directory, WINDOW_STATE_FILENAME)
    if (!existsSync(file)) return undefined
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return undefined
    const record = raw as Record<string, unknown>
    const bounds = parseBounds(record.bounds)
    if (bounds === undefined) return undefined
    return { bounds, maximized: record.maximized === true }
  } catch {
    return undefined
  }
}

/** 落盘失败只影响下次恢复，不影响本次运行。 */
export function writeWindowState(directory: string, state: WindowState): void {
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, WINDOW_STATE_FILENAME), `${JSON.stringify(state)}\n`)
  } catch { /* 下次启动回落到默认位置 */ }
}

/** 默认窗口尺寸在主屏工作区内居中。 */
export function centerWindowBounds(workArea: WindowBounds, width = DEFAULT_WINDOW_WIDTH, height = DEFAULT_WINDOW_HEIGHT): WindowBounds {
  const size = { width: Math.min(width, workArea.width), height: Math.min(height, workArea.height) }
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + (workArea.height - size.height) / 2),
    ...size,
  }
}

/**
 * 把保存的窗口矩形收敛到当前可用的显示器工作区：
 * 取交集面积最大的显示器；完全落在所有显示器之外时返回 undefined（调用方回落到默认位置）。
 * 尺寸限制在最小尺寸与该显示器工作区之间，位置保证整体可见。
 */
export function fitBoundsIntoWorkAreas(bounds: WindowBounds, workAreas: readonly WindowBounds[]): WindowBounds | undefined {
  let best: { area: WindowBounds, overlap: number } | undefined
  for (const area of workAreas) {
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    const overlap = Math.max(0, overlapWidth) * Math.max(0, overlapHeight)
    if (overlap > 0 && (best === undefined || overlap > best.overlap)) best = { area, overlap }
  }
  if (best === undefined) return undefined
  const { area } = best
  const width = Math.round(Math.min(Math.max(bounds.width, MIN_WINDOW_WIDTH), area.width))
  const height = Math.round(Math.min(Math.max(bounds.height, MIN_WINDOW_HEIGHT), area.height))
  return {
    x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)),
    width,
    height,
  }
}
