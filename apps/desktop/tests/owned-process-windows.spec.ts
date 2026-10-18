import { EventEmitter } from 'node:events'
import { type ChildProcess, spawn } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanOwnedProcessTree, stopOwnedProcess, trackOwnedProcess, selectOwnedWindowsProcesses, type WindowsProcessIdentity } from '../src/owned-process.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.restoreAllMocks() })
function fixture(rows: WindowsProcessIdentity[], options: { exited?: boolean, taskkillCode?: number, queryFails?: boolean, osPresent?: boolean } = {}) {
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
        task.stdout.emit('data', Buffer.from(JSON.stringify(rows))); task.emit('close', 0)
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
