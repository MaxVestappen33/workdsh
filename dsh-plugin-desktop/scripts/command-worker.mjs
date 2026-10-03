/** Own resource paths; upstream owns reversible command and PATH installation. */
import { inspectFileCommand, installFileCommand, removeFileCommand } from '../../deepseek-harness/apps/desktop/src/command-installation.ts'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
const root = dirname(fileURLToPath(import.meta.url))
const [operation, expected] = process.argv.slice(2)
try {
  if (!['inspect', 'install', 'remove'].includes(operation) || (operation !== 'inspect' && !/^[a-f0-9]{64}$/.test(expected ?? ''))) throw new Error('Invalid command operation')
  if (process.platform === 'darwin') {
    const options = { destination: '/usr/local/bin/dsh', launcher: join(root, 'bin/dsh'), linkHelper: join(root, 'link-entry') }
    const state = operation === 'inspect' ? await inspectFileCommand(options) : operation === 'install' ? await installFileCommand(options, expected) : await removeFileCommand(options, expected)
    process.stdout.write(JSON.stringify({ ok: true, state }) + '\n')
  } else if (process.platform === 'win32') {
    const system = process.env.SystemRoot ?? process.env.WINDIR
    if (!system) throw new Error('Windows system directory unavailable')
    const child = spawn(join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'command-path.ps1')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
    child.stdout.pipe(process.stdout)
    const completion = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    child.stdin.end(JSON.stringify({ operation, expected, directory: join(root, 'bin') }))
    process.exitCode = await completion ?? 1
  } else throw new Error('Only macOS and Windows support command installation')
} catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code ?? 'EIO', message: error.message }) + '\n') }
