/** Home-owned loopback origin, configured through the official webserver row. */
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import * as yaml from 'js-yaml'

const HOST = '127.0.0.1'
const STATE_FILE = '.workdsh-loopback.json'
const PATCH_FILE = '.workdsh-loopback.patch.yml'
// The carrier's lightweight declaration exposes load/dump only; retain a
// bundled module import for the schema API instead of an external require.
const codec = yaml as unknown as {
  JSON_SCHEMA: { extend(type: unknown): unknown }
  Type: new (tag: string, options: { kind: string, construct(value: unknown): unknown }) => unknown
  load(text: string, options: { schema: unknown }): unknown
  dump(value: unknown): string
}
const schema = codec.JSON_SCHEMA.extend(new codec.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: value => ({ __jsExpr: value }),
}))
export type RuntimePort = { managed: false } | { managed: true, host: string, port: number, patch: string }

async function readOptional(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function hasServerOverride(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasServerOverride)
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  // A user's row is authoritative, including expressions, TLS, compression,
  // disabling or replacing the server. Never evaluate or rewrite that layer.
  if (row.id === 'webserver') return true
  return Object.values(row).some(hasServerOverride)
}
async function savedPort(file: string): Promise<number | undefined> {
  const text = await readOptional(file)
  if (text === undefined) return undefined
  let state: { version?: unknown, host?: unknown, port?: unknown }
  try { state = JSON.parse(text) as typeof state } catch { throw new Error('工作区端口记录无效，请核对本机配置；未更改原有访问地址。') }
  if (!state || state.version !== 1 || state.host !== HOST || !Number.isInteger(state.port) || Number(state.port) < 1024 || Number(state.port) > 65535) {
    throw new Error('工作区端口记录无效，请核对本机配置；未更改原有访问地址。')
  }
  return Number(state.port)
}
/** Reserve briefly to check a bind; the official server remains the sole owner. */
async function availablePort(port: number): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(undefined)
      else reject(error)
    })
    probe.listen({ host: HOST, port, exclusive: true }, () => {
      const address = probe.address()
      const selected = address && typeof address === 'object' ? address.port : undefined
      probe.close(error => error ? reject(error) : resolve(selected))
    })
  })
}

/** Existing Homes keep their origin; a conflicting owner is never stopped. */
export async function prepareRuntimePort(home: string, userPatchFiles: string[], options: { preferredPort?: number, existingHome?: boolean } = {}): Promise<RuntimePort> {
  const preferredPort = options.preferredPort ?? 3080
  for (const file of userPatchFiles) {
    const text = await readOptional(file)
    if (text !== undefined && hasServerOverride(codec.load(text, { schema }))) return { managed: false }
  }
  await mkdir(home, { recursive: true, mode: 0o700 })
  const state = join(home, STATE_FILE)
  let port = await savedPort(state)
  if (port !== undefined) {
    if (await availablePort(port) === undefined) throw new Error(`此工作区原有地址 ${HOST}:${port} 正被占用。请先关闭占用该地址的应用后重试；为保留页面数据，本次未切换地址，也未停止其他进程。`)
  } else {
    port = await availablePort(preferredPort)
    // Before Home-owned records existed, this Desktop used 3080. Preserve
    // that origin for an existing Profile instead of hiding its localStorage.
    if (port === undefined && options.existingHome) throw new Error(`已有工作区原地址 ${HOST}:${preferredPort} 正被占用。为保留页面数据，本次未切换地址，也未停止其他进程；请关闭占用该地址的应用后重试。`)
    port ??= await availablePort(0)
    if (port === undefined) throw new Error('无法为工作区分配本机端口，请稍后重试。')
    try {
      await writeFile(state, JSON.stringify({ version: 1, host: HOST, port }) + '\n', { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // Another launch created this Home's origin while we probed. Reuse that
      // record; never replace it with a second origin chosen concurrently.
      port = await savedPort(state)
      if (port === undefined || await availablePort(port) === undefined) throw new Error('此工作区正在由另一个启动操作使用，请关闭重复窗口后重试。')
    }
  }
  const patch = join(home, PATCH_FILE), temporary = `${patch}.${randomUUID()}`
  try {
    await writeFile(temporary, codec.dump([{ id: 'webserver', config: { host: HOST, port } }]), { flag: 'wx', mode: 0o600 })
    await rename(temporary, patch)
  } finally { await rm(temporary, { force: true }) }
  return { managed: true, host: HOST, port, patch }
}

/** Probe/launch is a narrow race; report its actual bind error without scanning. */
export function runtimePortConflict(selection: RuntimePort, output: string): string | undefined {
  if (!selection.managed || !/\bEADDRINUSE\b|address already in use/iu.test(output)) return undefined
  return `工作区端口 ${selection.host}:${selection.port} 在启动时被占用，请关闭占用该地址的应用后重试。已保留原地址和数据，未停止其他进程。`
}
