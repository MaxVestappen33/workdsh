/** Main-process authentication; the opaque member token never enters a renderer or CLI. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { enterpriseConnection } from './connection-mode.ts'

export interface EnterpriseMember {
  id: string
  organizationId: string
  organizationName: string
  displayName: string
  email: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  mustChangePassword: boolean
}

function member(value: unknown): EnterpriseMember {
  if (!value || typeof value !== 'object') throw new Error('企业后台返回了无效的成员信息')
  const m = value as Record<string, unknown>
  if (['id', 'organizationId', 'organizationName', 'displayName', 'email', 'role'].some(k => typeof m[k] !== 'string' || !(m[k] as string).length)
    || typeof m.mustChangePassword !== 'boolean' || !['OWNER', 'ADMIN', 'MEMBER'].includes(String(m.role))) throw new Error('企业后台返回了无效的成员信息')
  if (m.mustChangePassword) throw new Error('请先在企业后台修改初始密码，再登录 Desktop')
  return { id: m.id as string, organizationId: m.organizationId as string, organizationName: m.organizationName as string,
    displayName: m.displayName as string, email: m.email as string, role: m.role as EnterpriseMember['role'], mustChangePassword: m.mustChangePassword }
}

export class EnterpriseLogin {
  readonly backendUrl: string
  readonly actor: EnterpriseMember
  #token: string
  #fetch: typeof fetch
  #lifetime = new AbortController()
  private constructor(origin: string, token: string, actor: EnterpriseMember, request: typeof fetch) {
    this.backendUrl = origin; this.#token = token; this.actor = Object.freeze(actor); this.#fetch = request
  }
  static async login(origin: string, account: string, password: string, request: typeof fetch = fetch): Promise<EnterpriseLogin> {
    const backend = enterpriseConnection(origin).portalOrigin
    if (!account.trim() || !password || account.length > 254 || password.length > 512) throw new Error('请输入账号和密码')
    const response = await request(`${backend}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.trim(), password }),
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    }).catch(() => { throw new Error('无法连接企业后台，请检查地址、证书和网络') })
    if (!response.ok) throw new Error(response.status === 401 ? '账号或密码不正确' : `企业登录失败 (${response.status})`)
    const result: unknown = await response.json()
    const data = result as { token?: unknown, member?: unknown }
    if (!data || typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(data.token)) throw new Error('企业登录响应无效')
    try {
      const verified = await request(`${backend}/api/auth/me`, { headers: { Authorization: `Bearer ${data.token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
        .catch(() => { throw new Error('无法核验企业账号，请检查后台连接') })
      if (!verified.ok) throw new Error('企业账号核验失败')
      const actor = member(await verified.json())
      const admitted = data.member as { id?: unknown, organizationId?: unknown }
      if (!admitted || admitted.id !== actor.id || admitted.organizationId !== actor.organizationId) throw new Error('企业账号归属不一致')
      return new EnterpriseLogin(backend, data.token, actor, request)
    } catch (error) {
      // Login already created a backend session, even though local admission has not succeeded.
      let revoked = false
      try {
        const response = await request(`${backend}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${data.token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
        revoked = response.ok || response.status === 401
      } catch { /* local admission remains refused */ }
      if (!revoked) throw new Error(`${error instanceof Error ? error.message : '企业账号核验失败'}；后台登录撤销尚未确认`)
      throw error
    }
  }
  async request(path: string, method = 'GET', body?: string): Promise<Response> {
    if (!this.#token) throw new Error('企业登录已退出')
    this.#lifetime.signal.throwIfAborted()
    return this.#fetch(`${this.backendUrl}${path}`, {
      method, headers: { Authorization: `Bearer ${this.#token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body }), redirect: 'error', signal: AbortSignal.any([this.#lifetime.signal, AbortSignal.timeout(10_000)]),
    })
  }
  cancelRequests(): void { this.#lifetime.abort() }
  async verify(): Promise<EnterpriseMember> {
    const response = await this.request('/api/auth/me')
    if (!response.ok) throw new Error(`企业认证无效 (${response.status})`)
    const current = member(await response.json())
    if (current.id !== this.actor.id || current.organizationId !== this.actor.organizationId) throw new Error('企业账号归属已改变，请重新登录')
    return current
  }
  async logout(): Promise<boolean> {
    const token = this.#token
    this.#token = ''; this.cancelRequests()
    if (!token) return true
    try {
      const r = await this.#fetch(`${this.backendUrl}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
      return r.ok || r.status === 401
    }
    catch { return false }
  }
}

export interface Authority {
  url: string
  key: string
  close(): Promise<void>
}

/** A capability-protected loopback bridge with a closed set of member-authorized operations. */
export async function startEnterpriseAuthority(login: EnterpriseLogin, deviceId: string, onLogout: () => void, onInvalid: () => void): Promise<Authority> {
  const key = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${key}`)
  let closing = false
  const server: Server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const reject = (status: number, message: string): void => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: message })) }
    if (closing) { reject(401, 'Desktop is signing out'); return }
    const supplied = Buffer.from(req.headers.authorization ?? '')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { reject(401, 'Desktop authentication required'); return }
    if (req.headers.origin) { reject(403, 'Browser requests are not admitted'); return }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/auth/logout' && req.method === 'POST' && !url.search) {
      closing = true; login.cancelRequests()
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"local":true}')
      res.once('finish', () => { setTimeout(onLogout, 100) }); return
    }
    const auth = ['/auth/me', '/api/auth/me'].includes(url.pathname) && req.method === 'GET' && !url.search
    const ingest = url.pathname === '/visible-sessions/ingest' && ['GET', 'POST', 'DELETE'].includes(req.method ?? '')
    const collaboration = !url.search && ((req.method === 'GET' && /^\/api\/collaboration\/(?:contract|colleagues|inbox|sent|notifications|(?:materials|handoffs)\/[\w-]{1,160}|handoffs\/[\w-]{1,160}\/messages)$/.test(url.pathname)) || (req.method === 'POST' && /^\/api\/collaboration\/(?:materials|handoffs|notifications\/[\w-]{1,160}\/read|handoffs\/[\w-]{1,160}\/(?:messages|complete))$/.test(url.pathname)));
    const extension = !url.search && ['GET', 'POST'].includes(req.method ?? '') && /^\/api\/extensions\/[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/.test(url.pathname)
    if (!auth && !ingest && !collaboration && !extension) { reject(404, 'Unknown Desktop operation'); return }
    let current: EnterpriseMember
    try { current = await login.verify() } catch {
      reject(401, 'Enterprise authorization unavailable')
      if (!closing) { closing = true; login.cancelRequests(); setImmediate(onInvalid) }
      return
    }
    if (closing) { reject(401, 'Desktop is signing out'); return }
    if (auth) {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...current, deviceId, backendUrl: login.backendUrl })); return
    }
    if (collaboration || extension) {
      try {
        let body: string | undefined;
        if(req.method==='POST') {
          if(!req.headers['content-type']?.startsWith('application/json')) { reject(400,'JSON required'); return }
          const chunks:Buffer[]=[];let size=0;
          for await(const part of req) { const chunk=Buffer.from(part);size+=chunk.length;if(size>8*1024*1024){reject(413,'Body too large');return}chunks.push(chunk) }
          body=Buffer.concat(chunks).toString('utf8');JSON.parse(body);
        }
        const response=await login.request(url.pathname,req.method,body);
        if(closing)return;
        if(!response.ok){reject(response.status, extension ? 'Enterprise extension rejected' : 'Enterprise collaboration rejected');return}
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(await response.json()));
      } catch {reject(502, extension ? 'Enterprise extension unavailable' : 'Enterprise collaboration unavailable')}
      return;
    }
    try {
      let body: string | undefined
      let target = '/api/member/visible-sessions'
      if (req.method === 'POST') {
        if (url.search || !req.headers['content-type']?.startsWith('application/json')) { reject(400, 'JSON required'); return }
        const chunks: Buffer[] = []; let size = 0
        for await (const part of req) {
          const chunk = Buffer.from(part); size += chunk.length
          if (size > 2 * 1024 * 1024) { reject(413, 'Body too large'); return }
          chunks.push(chunk)
        }
        body = Buffer.concat(chunks).toString('utf8')
        const data: unknown = JSON.parse(body)
        if (!data || typeof data !== 'object' || (data as { deviceId?: unknown }).deviceId !== deviceId) { reject(403, 'Device mismatch'); return }
      } else {
        const session = url.searchParams.get('sessionId')
        if (!session || session.length > 256 || [...url.searchParams.keys()].some(k => k !== 'sessionId') || url.searchParams.getAll('sessionId').length !== 1) { reject(400, 'Session required'); return }
        target += `?${new URLSearchParams({ deviceId, sessionId: session })}`
      }
      if (closing) { reject(401, 'Desktop is signing out'); return }
      const response = await login.request(target, req.method, body)
      if (closing) return
      // Never relay arbitrary upstream headers, cookies, secrets or diagnostics.
      if (!response.ok) { reject(response.status, 'Enterprise body synchronization rejected'); return }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(await response.json()))
    } catch { reject(502, 'Enterprise body synchronization unavailable') }
  })
  server.requestTimeout = 15_000; server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() }) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Desktop authority did not start')
  return { url: `http://127.0.0.1:${address.port}`, key, close: async () => { closing = true; login.cancelRequests(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
