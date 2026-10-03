/** The installed command delegates to the official CLI in the selected account space. */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { enterpriseEnvironment } from './local-runtime.ts'

export interface CommandSpace { mode: 'personal' | 'enterprise'; home: string; root?: string; label: string }
export function selectCommandSpace(context: { personalHome: string; active?: CommandSpace }, request?: string): CommandSpace {
  if (!isAbsolute(context.personalHome)) throw new Error('Invalid personal command space')
  if (request !== undefined && !['personal', 'enterprise'].includes(request)) throw new Error('请选择 personal 或 enterprise')
  const space = request === 'personal' || (!request && !context.active) ? { mode: 'personal' as const, home: context.personalHome, label: '个人工作区' } : context.active
  if (!space || !isAbsolute(space.home) || !['personal', 'enterprise'].includes(space.mode) || (request === 'enterprise' && space.mode !== 'enterprise')) throw new Error('请先在 Desktop 登录企业账号')
  if (space.mode === 'enterprise' && (!space.root || !isAbsolute(space.root) || space.home !== join(space.root, 'dsh'))) throw new Error('Invalid enterprise command space')
  return space
}
async function main(): Promise<void> {
  const userData = process.env.WORKDSH_DESKTOP_USER_DATA ?? (process.platform === 'win32' ? join(process.env.APPDATA ?? '', 'WorkDSH') : join(homedir(), 'Library/Application Support/WorkDSH'))
  const context = JSON.parse(readFileSync(join(userData, 'command-context.json'), 'utf8')) as { personalHome: string; active?: CommandSpace }
  const args = process.argv.slice(2), spaceOption = args.findIndex(value => value.startsWith('--workdsh-space='))
  const request = spaceOption < 0 ? undefined : args.splice(spaceOption, 1)[0]!.slice('--workdsh-space='.length)
  const space = selectCommandSpace(context, request)
  const launcher = join(space.home, '.workdsh-launch.mjs')
  const patch = join(space.home, '.enterprise-desktop.patch.yml')
  if (space.mode === 'enterprise' && (!existsSync(join(space.home, 'enterprise-auth.json')) || !existsSync(patch))) throw new Error('企业账号已退出，请重新登录 Desktop')
  if (!existsSync(launcher)) throw new Error('请先在 Desktop 打开此工作区，完成官方 Profile 初始化')
  const runtime = dirname(dirname(dirname(fileURLToPath(import.meta.url)))), primary = join(runtime, 'primary-runtime')
  const basePatch = join(runtime, 'profiles/workdsh/cordis.patch.yml')
  const patches = [...(existsSync(basePatch) ? ['--patch', basePatch] : []), ...(space.mode === 'enterprise' ? ['--patch', patch] : [])]
  const env = space.mode === 'enterprise' ? enterpriseEnvironment(space.root!, process.execPath, process.env) : { ...process.env }
  Object.assign(env, { DSH_HOME: space.home, DSH_AGENTS_HOME: space.mode === 'enterprise' ? join(space.root!, 'agents') : join(space.home, 'agents'), DSH_BUNDLED_PRIMARY_RUNTIME: primary, ELECTRON_RUN_AS_NODE: undefined })
  process.stderr.write(`WorkDSH：${space.label}\n`)
  const child = spawn(process.execPath, [launcher, '--profile', 'workdsh', ...patches, ...args], { cwd: space.home, env, stdio: 'inherit' })
  child.once('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) void main().catch(error => { process.stderr.write(String(error instanceof Error ? error.message : error) + '\n'); process.exitCode = 1 })
