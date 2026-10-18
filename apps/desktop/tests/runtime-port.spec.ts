import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { prepareRuntimePort, runtimePortConflict } from '../src/runtime-port.ts'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).filter(server => server.listening).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-port-test-')); roots.push(root); return root
}
async function occupied(port = 0): Promise<number> {
  const server = createServer((_request, response) => response.end('unrelated-host-retained')); servers.push(server)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address !== 'object') throw new Error('Missing listener')
  return address.port
}

it('coexists with an existing Host, persists a new origin and reuses it on reopening', async () => {
  const directory = await home(), existing = await occupied()
  const first = await prepareRuntimePort(directory, [], { preferredPort: existing })
  expect(first.managed).toBe(true)
  if (!first.managed) throw new Error('Expected managed port')
  expect(first.port).not.toBe(existing)
  expect(await (await fetch(`http://127.0.0.1:${existing}`)).text()).toBe('unrelated-host-retained')
  expect(JSON.parse(await readFile(join(directory, '.workdsh-loopback.json'), 'utf8'))).toEqual({ version: 1, host: '127.0.0.1', port: first.port })
  expect(load(await readFile(first.patch, 'utf8'))).toEqual([{ id: 'webserver', config: { host: '127.0.0.1', port: first.port } }])
  // A now-free preferred port cannot move an existing Home's browser origin.
  await new Promise<void>((resolve, reject) => servers[0]!.close(error => error ? reject(error) : resolve()))
  expect(await prepareRuntimePort(directory, [], { preferredPort: existing })).toEqual(first)
})

it('uses an available preferred port, but refuses to move a saved origin occupied by another process', async () => {
  const directory = await home(), probe = await occupied()
  await new Promise<void>((resolve, reject) => servers[0]!.close(error => error ? reject(error) : resolve()))
  const selected = await prepareRuntimePort(directory, [], { preferredPort: probe })
  expect(selected.managed && selected.port).toBe(probe)
  const state = await readFile(join(directory, '.workdsh-loopback.json'), 'utf8')
  await occupied(probe)
  await expect(prepareRuntimePort(directory, [], { preferredPort: 0 })).rejects.toThrow('未切换地址')
  expect(await readFile(join(directory, '.workdsh-loopback.json'), 'utf8')).toBe(state)
  expect(await (await fetch(`http://127.0.0.1:${probe}`)).text()).toBe('unrelated-host-retained')
})

it('gives independent Homes different available ports while both official origins are in use', async () => {
  const first = await prepareRuntimePort(await home(), [], { preferredPort: 0 })
  if (!first.managed) throw new Error('Expected managed port')
  await occupied(first.port)
  const second = await prepareRuntimePort(await home(), [], { preferredPort: first.port })
  expect(second.managed && second.port).not.toBe(first.port)
})

it('leaves explicit profile/Home/launcher webserver configuration and expressions untouched', async () => {
  for (const filename of ['profiles/workdsh/cordis.yml', 'profiles/workdsh/cordis.patch.yml', 'cordis.yml', 'cordis.patch.yml', 'explicit.patch.yml']) {
    const directory = await home(), file = join(directory, filename)
    await mkdir(join(directory, 'profiles/workdsh'), { recursive: true })
    const user = '# explicit user config\n- id: webserver\n  config:\n    host: 127.0.0.1\n    port: !!js "throw new Error(\'must-not-evaluate\')"\n'
    await writeFile(file, user)
    expect(await prepareRuntimePort(directory, [file], { preferredPort: 0 })).toEqual({ managed: false })
    expect(await readFile(file, 'utf8')).toBe(user)
    await expect(readFile(join(directory, '.workdsh-loopback.json'))).rejects.toHaveProperty('code', 'ENOENT')
  }
})

it('rejects invalid saved records without resetting the Home origin', async () => {
  const directory = await home(), file = join(directory, '.workdsh-loopback.json')
  for (const state of ['not-json', JSON.stringify({ version: 1, host: '0.0.0.0', port: 3080 }), JSON.stringify({ version: 1, host: '127.0.0.1', port: 0 })]) {
    await writeFile(file, state)
    await expect(prepareRuntimePort(directory, [], { preferredPort: 0 })).rejects.toThrow('未更改原有访问地址')
    expect(await readFile(file, 'utf8')).toBe(state)
  }
})

it('explains an actual EADDRINUSE launch race without treating unrelated failures as a port conflict', () => {
  const selection = { managed: true as const, host: '127.0.0.1', port: 3081, patch: '/owned/overlay.yml' }
  expect(runtimePortConflict(selection, 'Error: listen EADDRINUSE: address already in use 127.0.0.1:3081')).toContain('3081')
  expect(runtimePortConflict(selection, 'Error: plugin initialization failed')).toBeUndefined()
  expect(runtimePortConflict({ managed: false }, 'EADDRINUSE')).toBeUndefined()
})


it('keeps a legacy Home on its original port and refuses a busy origin before creating a new record', async () => {
  const directory = await home(), originalPort = await occupied()
  // The caller captured existingHome before prepareProfile created any files.
  await expect(prepareRuntimePort(directory, [], { preferredPort: originalPort, existingHome: true })).rejects.toThrow('未切换地址')
  await expect(readFile(join(directory, '.workdsh-loopback.json'))).rejects.toHaveProperty('code', 'ENOENT')
  expect(await (await fetch(`http://127.0.0.1:${originalPort}`)).text()).toBe('unrelated-host-retained')
  await new Promise<void>((resolve, reject) => servers[0]!.close(error => error ? reject(error) : resolve()))
  const migrated = await prepareRuntimePort(directory, [], { preferredPort: originalPort, existingHome: true })
  expect(migrated.managed && migrated.port).toBe(originalPort)
  expect(JSON.parse(await readFile(join(directory, '.workdsh-loopback.json'), 'utf8')).port).toBe(originalPort)
})
