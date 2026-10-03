import { EventEmitter } from 'node:events'
import { type ChildProcess, spawn } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { stopOwnedProcess } from '../src/owned-process.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

for (const exitCode of [0, 1]) it(`Windows tree cleanup ${exitCode === 0 ? 'confirms success' : 'rejects failure'}`, async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  const child = { pid: 424242, kill: vi.fn() } as unknown as ChildProcess
  vi.mocked(spawn).mockImplementation(() => {
    const task = new EventEmitter()
    queueMicrotask(() => task.emit('exit', exitCode))
    return task as ChildProcess
  })
  try {
    if (exitCode === 0) await expect(stopOwnedProcess(child)).resolves.toBeUndefined()
    else await expect(stopOwnedProcess(child)).rejects.toThrow('清理未确认')
    expect(spawn).toHaveBeenLastCalledWith('taskkill', ['/PID', '424242', '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    expect(child.kill).not.toHaveBeenCalled()
  } finally { Object.defineProperty(process, 'platform', descriptor) }
})
