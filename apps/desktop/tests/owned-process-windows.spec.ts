import { EventEmitter } from 'node:events'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { reclaimOrphanedToolProcesses, stopOwnedProcess } from '../src/owned-process.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }))

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

it('reclaims a leftover host by launcher path on Windows without scanning every process', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  vi.clearAllMocks()
  try {
    reclaimOrphanedToolProcesses("C:\\Users\\a\\AppData\\Roaming\\PoliceAssistant\\dsh-home\\o'brien\\.workdsh-host.mjs")
    expect(spawnSync).toHaveBeenCalledOnce()
    const [command, args, options] = vi.mocked(spawnSync).mock.calls[0]!
    expect(command).toBe('powershell.exe')
    expect(args?.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    const script = String(args?.[3])
    // 只筛 node.exe，避免全表扫描；命令行里按启动器路径精确匹配（单引号按 PowerShell 规则转义）。
    expect(script).toContain("Name='node.exe'")
    expect(script).toContain("Contains('C:\\Users\\a\\AppData\\Roaming\\PoliceAssistant\\dsh-home\\o''brien\\.workdsh-host.mjs')")
    expect(script).toContain('Stop-Process')
    expect(options).toEqual({ windowsHide: true, stdio: 'ignore' })
  } finally { Object.defineProperty(process, 'platform', descriptor) }
})
