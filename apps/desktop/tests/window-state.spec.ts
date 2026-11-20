import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  centerWindowBounds,
  fitBoundsIntoWorkAreas,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  readWindowState,
  WINDOW_STATE_FILENAME,
  writeWindowState,
} from '../src/window-state.ts'

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 }
const SECONDARY = { x: 1920, y: 0, width: 1280, height: 1024 }

it('round-trips the window state through userData', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workdsh-window-state-'))
  try {
    expect(readWindowState(directory)).toBeUndefined()
    writeWindowState(directory, { bounds: { x: 120, y: 80, width: 1280, height: 800 }, maximized: true })
    expect(readWindowState(directory)).toEqual({ bounds: { x: 120, y: 80, width: 1280, height: 800 }, maximized: true })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('ignores a corrupt state file instead of failing startup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workdsh-window-state-'))
  try {
    writeFileSync(join(directory, WINDOW_STATE_FILENAME), '{ not json')
    expect(readWindowState(directory)).toBeUndefined()
    writeFileSync(join(directory, WINDOW_STATE_FILENAME), JSON.stringify({ bounds: { x: 'a', y: 0, width: 100, height: 100 } }))
    expect(readWindowState(directory)).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps a saved window on the display it was closed on', () => {
  expect(fitBoundsIntoWorkAreas({ x: 2000, y: 100, width: 1000, height: 700 }, [PRIMARY, SECONDARY]))
    .toEqual({ x: 2000, y: 100, width: 1000, height: 700 })
})

it('falls back when the saved window is off every display', () => {
  expect(fitBoundsIntoWorkAreas({ x: 9000, y: 9000, width: 1000, height: 700 }, [PRIMARY, SECONDARY])).toBeUndefined()
})

it('clamps a half-off-screen window back into the work area', () => {
  expect(fitBoundsIntoWorkAreas({ x: 1700, y: 900, width: 1000, height: 700 }, [PRIMARY]))
    .toEqual({ x: 920, y: 340, width: 1000, height: 700 })
})

it('never restores a window smaller than the minimum size', () => {
  expect(fitBoundsIntoWorkAreas({ x: 100, y: 100, width: 400, height: 300 }, [PRIMARY]))
    .toEqual({ x: 100, y: 100, width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT })
})

it('centers the default window in the work area', () => {
  expect(centerWindowBounds(PRIMARY)).toEqual({ x: 240, y: 40, width: 1440, height: 960 })
  // 小屏上默认尺寸不能超出工作区。
  expect(centerWindowBounds({ x: 0, y: 0, width: 1280, height: 720 })).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
})
