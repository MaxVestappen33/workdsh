import { EventEmitter } from 'node:events'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanOwnedProcessTree, stopOwnedProcess, trackOwnedProcess, selectOwnedWindowsProcesses, reclaimOrphanedToolProcesses, type WindowsProcessIdentity } from '../src/owned-process.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.restoreAllMocks() })
function fixture(rows: WindowsProcessIdentity[], options: { exited?: boolean, taskkillCode?: number, queryFails?: boolean, osPresent?: boolean, unreadable?: boolean } = {}) {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  const missing = Object.assign(new Error('missing'), { code: 'ESRCH' })
  vi.spyOn(process, 'kill').mockImplementation(() => { if (options.osPresent) return true; throw missing })
  const child = Object.assign(new EventEmitter(), { pid: 424242, kill: vi.fn(), exitCode: options.exited ? 0 : null, signalCode: null }) as unknown as ChildProcess
  trackOwnedProcess(child, 900)
  if (options.exited) child.emit('exit', 0)
  const killed: number[] = [], scripts: string[] = []
  vi.mocked(spawn).mockImplementation((_command, args) => {
    const script = Buffer.from(String(args![args!.length - 1]), 'base64').toString('utf16le'); scripts.push(script)
    const task = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() })
    queueMicrotask(() => {
      if (script.includes('/PID')) {
        const pid = Number(script.match(/\/PID (\d+)/u)![1]); killed.push(pid)
        const code = options.taskkillCode ?? 0
        if (code === 0) rows = rows.filter(row => row.pid !== pid)
        task.stdout.emit('data', Buffer.from(JSON.stringify({ status: 'taskkill', code })))
        task.emit('close', 0)
      } else if (options.queryFails) {
        task.stderr.emit('data', Buffer.from('Access denied')); task.emit('close', 1)
      } else {
        // unreadable：模拟保护区/其它用户进程（创建时间读不到），这类行不能参与归属判定。
        const payload = options.unreadable ? [...rows, { pid: 424242, ppid: 1, createdAt: null }] : rows
        task.stdout.emit('data', Buffer.from(JSON.stringify(payload))); task.emit('close', 0)
      }
    })
    return task as unknown as ChildProcess
  })
  return { child, killed, scripts }
}

it('confirms an already absent root only after CIM finds no owned descendants and OS reports ESRCH', async () => {
  const { child, killed } = fixture([], { exited: true })
  await expect(cleanOwnedProcessTree(child)).resolves.toBeUndefined()
  expect(killed).toEqual([])
  expect(process.kill).toHaveBeenCalledWith(424242, 0)
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

it('cleans living descendants even when their owned root has already exited', async () => {
  const { child, killed, scripts } = fixture([
    { pid: 424243, ppid: 424242, createdAt: 950 },
    { pid: 424244, ppid: 424243, createdAt: 980 },
  ], { exited: true })
  await expect(stopOwnedProcess(child)).resolves.toBeUndefined()
  expect(killed).toEqual([424244, 424243])
  expect(scripts.filter(script => script.includes('/PID')).every(script => script.includes('CreationDate') && script.includes('-ne'))).toBe(true)
  expect(child.kill).not.toHaveBeenCalled()
})

it('preserves real taskkill permission failures instead of treating every nonzero exit as an absent PID', async () => {
  const { child, killed } = fixture([{ pid: 424242, ppid: 1, createdAt: 950 }], { taskkillCode: 1, osPresent: true })
  await expect(stopOwnedProcess(child)).rejects.toThrow('清理失败 (1)')
  expect(killed).toEqual([424242])
})

it('does not accept not-found status when the operating system still sees the owned process', async () => {
  const { child } = fixture([{ pid: 424242, ppid: 1, createdAt: 950 }], { taskkillCode: 128, osPresent: true })
  await expect(stopOwnedProcess(child)).rejects.toThrow('清理失败 (128)')
})

it('skips a reused root PID and its new children without signalling or killing the new generation', async () => {
  const { child, killed } = fixture([
    { pid: 424242, ppid: 1, createdAt: 1100 },
    { pid: 424243, ppid: 424242, createdAt: 1110 },
  ], { exited: true, osPresent: true })
  await expect(stopOwnedProcess(child)).resolves.toBeUndefined()
  expect(killed).toEqual([])
  expect(process.kill).not.toHaveBeenCalled()
})

it('fails closed when the public process inventory cannot be queried', async () => {
  const { child, killed } = fixture([], { exited: true, queryFails: true })
  await expect(stopOwnedProcess(child)).rejects.toThrow('清理查询失败')
  expect(killed).toEqual([])
})

it('does not signal a Windows process without a carrier ownership record', async () => {
  fixture([])
  const child = { pid: 999999 } as ChildProcess
  await expect(stopOwnedProcess(child)).rejects.toThrow('缺少所有权记录')
})

it('accepts an exited root whose PID is now held by a process we cannot identify', async () => {
  // 现场回归：本机 Host 已经退出，快照里没有任何本次启动的进程，但系统探测到同名 PID
  // （被复用的其它进程）。此前会判定「清理未确认」，把退出流程卡死。
  const { child, killed } = fixture([], { exited: true, osPresent: true })
  await expect(cleanOwnedProcessTree(child)).resolves.toBeUndefined()
  expect(killed).toEqual([])
})

it('ignores process rows without a readable creation time instead of failing the cleanup', async () => {
  // 创建时间读不到的行无法证明归属：跳过它，而不是让整次清理失败。
  const { child, killed } = fixture([], { exited: true, osPresent: true, unreadable: true })
  await expect(cleanOwnedProcessTree(child)).resolves.toBeUndefined()
  expect(killed).toEqual([])
})

it('keeps old orphaned descendants while excluding children created by a reused parent generation', () => {
  const rows = [
    { pid: 42, ppid: 1, createdAt: 1200 },
    { pid: 43, ppid: 42, createdAt: 950 },
    { pid: 44, ppid: 42, createdAt: 1250 },
  ]
  expect(selectOwnedWindowsProcesses(rows, { pid: 42, startedAt: 900, registeredAt: 1000, exitedAt: 1100 })).toEqual([rows[1]])
})

it('does not claim a parent generation that predates the owned spawn window', () => {
  expect(selectOwnedWindowsProcesses([{ pid: 42, ppid: 1, createdAt: 800 }, { pid: 43, ppid: 42, createdAt: 950 }], { pid: 42, startedAt: 900, registeredAt: 1000, exitedAt: 1100 })).toEqual([])
})

it.skipIf(platform.value !== 'win32')('reclaims a real Windows tool after its tracked parent has exited', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  vi.mocked(spawn).mockImplementation(actual.spawn)
  const fixture = `const {spawn}=require('node:child_process');
const tool=spawn(process.execPath,['-e',"console.log(process.pid);setInterval(()=>{},1000);setTimeout(()=>process.exit(0),30000)"],{stdio:['ignore','pipe','inherit']});
tool.stdout.once('data',data=>{process.stdout.write(data,()=>process.exit(0))});`
  const startedAt = Date.now()
  const parent = spawn(process.execPath, ['-e', fixture], { stdio: ['ignore', 'pipe', 'pipe'] })
  trackOwnedProcess(parent, startedAt)
  const exited = new Promise<void>(resolve => parent.once('exit', () => resolve()))
  let descendant = 0
  try {
    descendant = await new Promise<number>((resolve, reject) => { parent.stdout!.once('data', chunk => resolve(Number(String(chunk).trim()))); parent.once('error', reject) })
    expect(descendant).toBeGreaterThan(0)
    await exited
    await cleanOwnedProcessTree(parent)
    await vi.waitFor(() => expect(() => process.kill(descendant, 0)).toThrow(), { timeout: 3000 })
    await cleanOwnedProcessTree(parent)
  } finally {
    // Retry only through the generation-checked owner. The synthetic tool also
    // has a 30-second deadline if Windows refuses cleanup, without targeting
    // an unrelated process based on a possibly reused naked PID.
    await cleanOwnedProcessTree(parent)
  }
}, 20_000)
