import { afterEach, describe, expect, it } from 'vitest'
import { EnterpriseLogin, startEnterpriseAuthority, type Authority } from '../src/enterprise-auth.ts'

const actor = { id: 'member-a', organizationId: 'org-a', organizationName: 'Example company', displayName: 'A', email: 'a@example.test', role: 'MEMBER', mustChangePassword: false }
const token = 'A'.repeat(43)
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
let bridge: Authority | undefined
afterEach(async () => { await bridge?.close(); bridge = undefined })

describe('Desktop Main enterprise authority', () => {
  it.each(['network', 'rejected', 'password-change', 'ownership-change'])('revokes an issued session if subsequent admission fails: %s', async failure => {
    const calls: { url: string, init?: RequestInit }[] = []
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) })
      if (String(url).endsWith('/login')) return json({ token, member: actor })
      if (String(url).endsWith('/logout')) return json({})
      if (failure === 'network') throw new Error('network unavailable')
      if (failure === 'rejected') return json({}, 401)
      return json({ ...actor, ...(failure === 'password-change' ? { mustChangePassword: true } : { id: 'other-member' }) })
    }) as typeof fetch
    await expect(EnterpriseLogin.login('https://company.test', actor.email, 'password', request)).rejects.toThrow()
    const revoked = calls.filter(call => call.url.endsWith('/logout'))
    expect(revoked).toHaveLength(1)
    expect(revoked[0]?.init).toMatchObject({ method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error' })
  })
  it('reports an unconfirmed remote revocation when both admission and cleanup are offline', async () => {
    const request = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/login')) return json({ token, member: actor })
      throw new Error('network unavailable')
    }) as typeof fetch
    await expect(EnterpriseLogin.login('https://company.test', actor.email, 'password', request)).rejects.toThrow('后台登录撤销尚未确认')
  })
  it('uses the actual login contract, rechecks membership, and keeps tokens out of account responses', async () => {
    const calls: { url: string, init?: RequestInit }[] = []
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) })
      return String(url).endsWith('/login') ? json({ token, member: actor }) : json({ ...actor, token, unexpectedSecret: 'hidden' })
    }) as typeof fetch
    const login = await EnterpriseLogin.login('https://company.test', 'a@example.test', 'password', request)
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ email: actor.email, password: 'password' })
    expect(calls[0]?.init?.redirect).toBe('error')
    expect(calls[1]?.init?.headers).toEqual({ Authorization: `Bearer ${token}` })
    bridge = await startEnterpriseAuthority(login, 'device-a', () => {}, () => {})
    const response = await fetch(`${bridge.url}/auth/me`, { headers: { Authorization: `Bearer ${bridge.key}` } })
    expect(await response.json()).toEqual({ ...actor, deviceId: 'device-a', backendUrl: 'https://company.test' })
    expect(JSON.stringify(login)).not.toContain(token)
  })
  it('rejects browser requests, unknown operations and a forged device before upstream ingestion', async () => {
    let ingested = 0
    const request = (async (url: string | URL | Request) => {
      if (String(url).includes('visible-sessions')) ingested++
      return String(url).endsWith('/login') ? json({ token, member: actor }) : json(actor)
    }) as typeof fetch
    const login = await EnterpriseLogin.login('http://127.0.0.1:12345', actor.email, 'password', request)
    bridge = await startEnterpriseAuthority(login, 'device-a', () => {}, () => {})
    expect((await fetch(`${bridge.url}/auth/me`)).status).toBe(401)
    const headers = { Authorization: `Bearer ${bridge.key}`, 'Content-Type': 'application/json' }
    expect((await fetch(`${bridge.url}/auth/me`, { headers: { ...headers, Origin: 'https://evil.test' } })).status).toBe(403)
    expect((await fetch(`${bridge.url}/anything`, { headers })).status).toBe(404)
    expect((await fetch(`${bridge.url}/visible-sessions/ingest`, { method: 'POST', headers, body: JSON.stringify({ deviceId: 'device-b' }) })).status).toBe(403)
    expect(ingested).toBe(0)
  })
  it('fails closed when the account changes or the server revokes a token', async () => {
    let revoked = false
    let invalid = 0
    const request = (async (url: string | URL | Request) => String(url).endsWith('/login') ? json({ token, member: actor }) : revoked ? json({}, 401) : json(actor)) as typeof fetch
    const login = await EnterpriseLogin.login('https://company.test', actor.email, 'password', request)
    bridge = await startEnterpriseAuthority(login, 'device-a', () => {}, () => { invalid++ })
    revoked = true
    expect((await fetch(`${bridge.url}/auth/me`, { headers: { Authorization: `Bearer ${bridge.key}` } })).status).toBe(401)
    await new Promise(resolve => setImmediate(resolve))
    expect(invalid).toBe(1)
    await expect(login.verify()).rejects.toThrow()
  })
  it('cancels an in-flight authorization check on logout and never forwards its upload afterward', async () => {
    let pause = false
    let checking!: () => void
    const started = new Promise<void>(resolve => { checking = resolve })
    let ingested = 0, invalid = 0
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('visible-sessions')) ingested++
      if (pause && String(url).endsWith('/me')) {
        checking()
        return await new Promise<Response>((_, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
        })
      }
      return String(url).endsWith('/login') ? json({ token, member: actor }) : json(actor)
    }) as typeof fetch
    const login = await EnterpriseLogin.login('https://company.test', actor.email, 'password', request)
    bridge = await startEnterpriseAuthority(login, 'device-a', () => {}, () => { invalid++ })
    pause = true
    const headers = { Authorization: `Bearer ${bridge.key}`, 'Content-Type': 'application/json' }
    const pending = fetch(`${bridge.url}/visible-sessions/ingest`, { method: 'POST', headers, body: JSON.stringify({ deviceId: 'device-a' }) })
    await started
    const logout = await fetch(`${bridge.url}/auth/logout`, { method: 'POST', headers })
    expect(await logout.json()).toEqual({ local: true })
    expect((await pending).status).toBe(401)
    expect((await fetch(`${bridge.url}/auth/me`, { headers })).status).toBe(401)
    expect(ingested).toBe(0); expect(invalid).toBe(0)
  })
  it('forgets local login even if remote logout is unavailable', async () => {
    const request = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/logout')) throw new Error('offline')
      return String(url).endsWith('/login') ? json({ token, member: actor }) : json(actor)
    }) as typeof fetch
    const login = await EnterpriseLogin.login('https://company.test', actor.email, 'password', request)
    expect(await login.logout()).toBe(false)
    await expect(login.verify()).rejects.toThrow('已退出')
  })
})
