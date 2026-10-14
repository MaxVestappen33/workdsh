/** Stop only the process tree created by this carrier. A parent exit is not a tree exit. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

const cleaned = new WeakMap<ChildProcess, Promise<void>>()
export function cleanOwnedProcessTree(child: ChildProcess): Promise<void> {
  const existing = cleaned.get(child)
  if (existing) return existing
  const pid = child.pid
  let result: Promise<void>
  if (!pid) result = Promise.resolve()
  else if (process.platform !== 'win32') {
    // Run immediately when the parent exits, while its group still belongs to its descendants.
    try { process.kill(-pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    result = Promise.resolve()
  } else {
    result = new Promise<void>((resolve, reject) => {
      const task = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      task.once('error', () => reject(new Error('Windows 本机进程树未能停止')))
      task.once('exit', code => code === 0 ? resolve() : reject(new Error('Windows 本机进程树清理未确认')))
    })
  }
  cleaned.set(child, result)
  return result
}

export async function stopOwnedProcess(child: ChildProcess): Promise<void> {
  if (process.platform === 'win32') { await cleanOwnedProcessTree(child); return }
  if (child.exitCode !== null || child.signalCode !== null) { await cleanOwnedProcessTree(child); return }
  await new Promise<void>((resolve, reject) => {
    // Official DSH exits after its own five-second shutdown window. Leave its exit finalizer time to run.
    const force = setTimeout(() => { void cleanOwnedProcessTree(child).catch(reject) }, 8000)
    const timeout = setTimeout(() => { clearTimeout(force); reject(new Error('本机进程尚未停止')) }, 12000)
    child.once('exit', () => {
      clearTimeout(force); clearTimeout(timeout)
      // Do not cancel descendant cleanup just because the parent acknowledged SIGTERM.
      void cleanOwnedProcessTree(child).then(resolve, reject)
    })
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    } else child.kill('SIGTERM')
  })
}

/**
 * 兜底回收上次异常退出遗留的本机工具进程。
 *
 * 工具进程以 detached 方式启动（macOS/Linux 下自成进程组），终端 Ctrl+C 只会杀掉载体，
 * 工具进程会成为孤儿继续占用端口，导致下一次启动报 EADDRINUSE。
 * Windows 下用任务管理器结束应用、或安装程序只结束载体窗口时同样会留下孤儿 DSH 主机。
 * 这里按“启动器脚本路径”精确匹配进程命令行回收，避免误伤无关进程；脚本路径本身是
 * 每套 Profile 唯一的绝对路径，因此匹配到的都属于本安装的遗留进程。
 */
export function reclaimOrphanedToolProcesses(launcher: string): void {
  if (launcher.length === 0) return
  if (process.platform === 'win32') { reclaimWindowsToolProcesses(launcher); return }
  const listing = spawnSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' })
  if (listing.error !== undefined || listing.status !== 0 || typeof listing.stdout !== 'string') return
  for (const line of listing.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line)
    if (match === null) continue
    const pid = Number(match[1])
    if (!Number.isInteger(pid) || pid <= 1 || !match[2]!.includes(launcher)) continue
    // 先按进程组回收（涵盖工具派生的子进程），失败再退化为单进程回收。
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { /* 已退出 */ } }
  }
}

/**
 * Windows：没有 ps，改用 CIM 读取命令行后按启动器路径精确回收。
 * 只筛选 node.exe（本机 DSH 主机由随包 Node 启动），既避免全表扫描，也保证不会命中载体自身。
 */
function reclaimWindowsToolProcesses(launcher: string): void {
  const command = [
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`,
    `| Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${launcher.replaceAll("'", "''")}') }`,
    '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join(' ')
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'ignore' })
}
