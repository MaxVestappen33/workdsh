import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { inspectStartedHost, hostSmokeEnvironment, waitForPackagedHostReady } from '../scripts/packaged-host-smoke.mjs'

describe('packaged full Host startup', () => {
  it('requires initialized selected products while allowing optional lazy official plugins', () => {
    const profile = { startedBundles: ['workdsh-plugin-workbenches'], installAnchor: '/actual/resources/profile-installation.json' }
    const values = new Map<string, unknown>([['profileContext', profile], ['workdshWorkbenchRegistration', {}], ['storageDomain', {}]])
    const mandatory = { name: 'workdsh-workbenches', fibers: [{ state: 2 }] }
    const ctx = { fiber: { state: 2 }, get: (key: string) => values.get(key), registry: new Map([['owned', mandatory], ['optional-model', { name: 'optional-model', fibers: [{ state: 0 }] }]]) }
    expect(inspectStartedHost(ctx, { 'workdsh-plugin-workbenches': 'workdshWorkbenchRegistration' }, ['storageDomain']).services).toEqual(['workdshWorkbenchRegistration'])
    mandatory.fibers[0]!.state = 0
    expect(() => inspectStartedHost(ctx, { 'workdsh-plugin-workbenches': 'workdshWorkbenchRegistration' }, ['storageDomain'])).toThrow('initialization is incomplete')
    mandatory.fibers[0]!.state = 2
    values.delete('workdshWorkbenchRegistration')
    expect(() => inspectStartedHost(ctx, { 'workdsh-plugin-workbenches': 'workdshWorkbenchRegistration' }, ['storageDomain'])).toThrow('service is unavailable')
  })

  it('does not inherit credentials, real Home or user DSH state', () => {
    const env = hostSmokeEnvironment('/isolated/test', '/actual/primary', '/actual/node/bin/node', { PATH: '/usr/bin', HOME: '/real/user', DSH_HOME: '/real/state', API_KEY: 'must-not-inherit', TOKEN: 'must-not-inherit', NODE_OPTIONS: '--require=private-file' })
    expect(env.HOME).toBe('/isolated/test')
    expect(env.DSH_HOME).toBe('/isolated/test')
    expect(env.DSH_BUNDLED_PRIMARY_RUNTIME).toBe('/actual/primary')
    expect(env.API_KEY).toBeUndefined()
    expect(env.TOKEN).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('does not accept an HTTP listening message when a required dynamic import fails', async () => {
    const child = spawn(process.execPath, ['-e', `console.log('http://127.0.0.1:12345/?token=private-process-token');console.error("Cannot find package '@deepseek-ai/dsh-atomic-write'");process.exitCode=1;`], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const closed = new Promise(resolve => child.once('close', resolve))
    await expect(waitForPackagedHostReady(child, { timeoutMs: 2000 }).ready).rejects.toThrow('@deepseek-ai/dsh-atomic-write')
    await closed
    expect(child.exitCode).toBe(1)
  })

  it('waits for both official ready and product service receipt', async () => {
    const child = spawn(process.execPath, ['-e', `process.send({kind:'workdsh-packaged-host-ready',products:['workdsh-plugin-workbenches'],services:['workdshWorkbenchRegistration'],installAnchor:'/actual/anchor'});setTimeout(()=>console.log('http://127.0.0.1:12345/?token=private-process-token'),20);setTimeout(()=>{},3000);`], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    try {
      const startup = waitForPackagedHostReady(child, { timeoutMs: 2000 })
      const result = await startup.ready
      expect(result.receipt.services).toEqual(['workdshWorkbenchRegistration'])
      expect(result.diagnostics()).toContain('?token=[redacted]')
      expect(result.diagnostics()).not.toContain('private-process-token')
    } finally {
      child.kill('SIGTERM')
      await new Promise(resolve => child.once('close', resolve))
    }
  })
})
