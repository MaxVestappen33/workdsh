#!/usr/bin/env node
/**
 * 重建 WorkDSH Web 插件并重启桌面开发进程（通用）。
 *
 * 仅运行 `yarn dev` 不会重建 web 插件包：桌面运行时从打包好的 Profile 安装插件，
 * 所以改动任何插件源码后都必须依次「构建插件 → 重打包 Profile → 重装运行时 → 启动」。
 *
 * 用法：
 *   node scripts/dev-rebuild.mjs                          # 构建全部插件并重启
 *   node scripts/dev-rebuild.mjs --filter <包名>          # 只构建指定包（可重复）
 *   node scripts/dev-rebuild.mjs --no-start               # 只重建，不启动
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = join(root, 'apps/web')
const release = join(root, 'apps/desktop/build/workdsh-profile-release')
const marker = join(root, 'apps/desktop/build/workdsh-runtime/profiles/workdsh/.workdsh-desktop-release.json')

/** 解析命令行：--no-start 与可重复的 --filter。 */
function parseArgs(argv) {
  const filters = []
  let start = true
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--no-start') start = false
    else if (arg === '--filter') filters.push(argv[++index])
    else if (arg.startsWith('--filter=')) filters.push(arg.slice('--filter='.length))
    else throw new Error(`未知参数：${arg}`)
  }
  const invalid = filters.find(name => !name || name.startsWith('-'))
  if (invalid !== undefined) throw new Error('--filter 需要跟一个包名。')
  return { start, filters }
}

/** 执行一步命令；失败默认中止。 */
function run(label, command, args, { cwd = root, tolerateFailure = false } = {}) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0 && !tolerateFailure) throw new Error(`${label} 失败（退出码 ${result.status}）`)
}

/** 读取当前进程表，用于结束上一轮开发进程。 */
function listProcesses() {
  const output = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? ''
  return output.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line)
    return match ? [{ pid: Number(match[1]), command: match[2] }] : []
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const isAlive = pid => {
  try { process.kill(pid, 0); return true } catch { return false }
}

/** 结束本工作区上一轮 `yarn dev` 拉起的桌面进程，避免端口/运行时目录冲突。 */
async function stopExistingDev() {
  if (process.platform === 'win32') {
    console.warn('Windows 下无法自动结束旧进程，请先手动停止现有的 yarn dev。')
    return
  }
  const markers = [
    join(root, 'apps/desktop/scripts/start-workdsh.mjs'),
    join(root, 'apps/desktop/build/workdsh-runtime'),
    join(root, 'apps/desktop/node_modules/electron/dist'),
  ]
  const targets = listProcesses().filter(({ pid, command }) =>
    pid !== process.pid && markers.some(marker => command.includes(marker)))
  if (!targets.length) return
  console.log(`\n==> 结束上一轮开发进程（${targets.length} 个）`)
  for (const { pid } of targets) {
    try { process.kill(pid, 'SIGTERM') } catch { /* 已退出 */ }
  }
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline && targets.some(({ pid }) => isAlive(pid))) await sleep(200)
  for (const { pid } of targets.filter(({ pid }) => isAlive(pid))) {
    try { process.kill(pid, 'SIGKILL') } catch { /* 已退出 */ }
  }
}

async function launchDev() {
  console.log('\n==> 启动桌面开发进程')
  const child = spawn('corepack', ['yarn', 'dev'], { cwd: root, stdio: 'inherit' })
  const code = await new Promise(resolve => child.on('exit', resolve))
  process.exitCode = typeof code === 'number' ? code : 1
}

const { start, filters } = parseArgs(process.argv.slice(2))

// 1. 构建插件包：默认全部，也可只构建指定包（按依赖顺序执行各自的 build）。
if (filters.length) {
  run(`构建插件（${filters.join('、')}）`, 'corepack', [
    'pnpm', ...filters.flatMap(name => ['--filter', name]), 'build',
  ], { cwd: webRoot })
} else {
  run('构建全部 WorkDSH Web 插件', 'corepack', ['pnpm', 'build'], { cwd: webRoot })
}

// 2. 重新打包 Profile；release 目录不可复用，先删除。
rmSync(release, { recursive: true, force: true })
run('打包 WorkDSH Profile', process.execPath, [
  join(root, 'apps/desktop/scripts/pack-workdsh-profile.mjs'),
  'apps/web',
  release,
])

// 3. 重装运行时：这一步才会把新插件安装进桌面运行时。
//    该命令可能在收尾清理时返回非零退出码，因此以安装结果校验为准。
run('重装 WorkDSH 运行时', 'corepack', ['yarn', 'workspace', 'dsh-plugin-desktop', 'prepare:workdsh-runtime'], {
  tolerateFailure: true,
})

// 4. 校验运行时确实来自刚打包的 Profile。
if (!existsSync(marker)) throw new Error('运行时缺少 release 标记，请检查「重装 WorkDSH 运行时」的输出。')
const installed = JSON.parse(readFileSync(marker, 'utf8')).release?.packages
const packed = JSON.parse(readFileSync(join(release, 'release-manifest.json'), 'utf8')).packages
if (JSON.stringify(installed) !== JSON.stringify(packed)) {
  throw new Error('运行时中的插件归档与本次打包结果不一致，请检查「重装 WorkDSH 运行时」的输出。')
}
console.log('\n✔ 运行时已包含本次构建（制品哈希与最新 Profile 一致）')

if (!start) {
  console.log('已完成重建（未启动）。运行 corepack yarn dev 即可启动。')
} else {
  await stopExistingDev()
  await launchDev()
}
