import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanOwnedProcessTree, stopOwnedProcess } from './owned-process.ts'
import { createRuntimeOutputRedactor, officialCommandFailureDetail } from './runtime-diagnostics.ts'

/** Preserve the actual CLI failure before returning control to the entry screen. */
export async function runOfficialCommand(options: {
  executable: string, launcher: string, args: string[], home: string, env: NodeJS.ProcessEnv,
  logDirectory: string, timeoutMs?: number, cancelled: () => boolean,
  onProcess: (child: ChildProcess | undefined) => void,
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(options.executable, [options.launcher, ...options.args], {
      env: options.env, cwd: options.home, detached: process.platform !== 'win32',
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    options.onProcess(child)
    let output = '', settled = false, cleanupConfirmed = false, cause: string | undefined
    let cleanup = Promise.resolve()
    const record = (text: string): void => { output = `${output}${text}`.slice(-16_384) }
    const stdout = createRuntimeOutputRedactor(record), stderr = createRuntimeOutputRedactor(record)
    const finish = async (code: number | null): Promise<void> => {
      if (settled) return
      settled = true; clearTimeout(timer)
      stdout.end(); stderr.end()
      try { await cleanup } catch { cause ??= '本机安装进程停止尚未确认' }
      if (!child.pid || cleanupConfirmed) options.onProcess(undefined)
      if (!cause && !options.cancelled() && code === 0) { resolve(); return }
      let detail = officialCommandFailureDetail(code, output, options.cancelled() ? '插件安装已取消' : cause)
      try {
        mkdirSync(options.logDirectory, { recursive: true })
        const path = join(options.logDirectory, 'plugin-operation-failure.log')
        writeFileSync(path, `${new Date().toISOString()}\n${detail}\n\n最近的工具输出：\n${output}\n`, { mode: 0o600 })
        detail += `\n\n错误记录：${path}`
      } catch { /* Keep the real cause even if its local record cannot be written. */ }
      reject(new Error(detail))
    }
    const timer = setTimeout(() => {
      cause = '插件依赖更新超时，请检查网络后重试'
      cleanup = stopOwnedProcess(child).then(() => { cleanupConfirmed = true }, () => { cause += '；本机安装进程停止尚未确认' })
      void cleanup.then(() => finish(child.exitCode))
    }, options.timeoutMs ?? 240_000)
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.stdout.once('end', () => stdout.end())
    child.stderr.once('end', () => stderr.end())
    child.once('error', error => { cause = `无法启动插件安装工具：${error.message}`; void finish(null) })
    // Kill only our descendants promptly; wait for close to capture the final stderr.
    child.once('exit', () => {
      cleanup = Promise.resolve().then(() => cleanOwnedProcessTree(child))
        .then(() => { cleanupConfirmed = true }, () => { cause ??= '本机安装进程停止尚未确认' })
    })
    child.once('close', code => {
      if (!settled) void finish(code)
      else void cleanup.then(() => { if (cleanupConfirmed) options.onProcess(undefined) })
    })
  })
}
