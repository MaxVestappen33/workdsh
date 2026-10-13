/** Main-process account authentication. The opaque bearer token never enters a renderer. */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type { ServerConfig } from './app-config.ts'

/** The signed-in account profile surfaced to the DSH provider and authority. */
export interface AccountUser {
  userId: string
  username: string
  displayName: string
  avatar?: string
  phone?: string
  organizationId: string
  organizationName: string
  role: string
}

/** Encrypted payload written to disk. */
export interface AccountSession {
  token: string
  /** JWT exp (seconds) if the token carried one; undefined if opaque. */
  expiry?: number
  user: AccountUser
  /** The raw userInfo delivered by the login response (kept whole for later permission use). */
  rawUserInfo: Record<string, unknown>
}

const SESSION_FILENAME = 'account-session.bin'
/** 本机加密密钥（macOS 路径用）：32 字节，随会话一起放在 userData 下，权限 0600。 */
const KEY_FILENAME = '.account-key'
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,160}$/u.test(value)

// The account service returns user identity inside result.userInfo with an `id` field.
// Derive a stable principal/organization identity for DSH-side resolution.
export function accountUser(baseUrl: string, userInfo: Record<string, unknown>): AccountUser {
  const id = userInfo.id
  const username = userInfo.username
  const realname = userInfo.realname ?? username
  if (typeof id !== 'string' || !identifier(id) || typeof username !== 'string' || !identifier(username) ||
      typeof realname !== 'string' || !realname || realname.length > 256) throw new Error('登录响应缺少有效的用户信息')
  const displayName = String(realname)
  const organizationId = typeof userInfo.orgCode === 'string' && identifier(userInfo.orgCode) ? userInfo.orgCode : 'personal'
  const organizationName = typeof userInfo.orgCodeTxt === 'string' && userInfo.orgCodeTxt ? userInfo.orgCodeTxt : webHost(baseUrl)
  return {
    userId: id, username, displayName,
    ...(typeof userInfo.avatar === 'string' && userInfo.avatar ? { avatar: userInfo.avatar } : {}),
    ...(typeof userInfo.phone === 'string' && userInfo.phone ? { phone: userInfo.phone } : {}),
    organizationId: organizationId as string,
    organizationName,
    role: 'member',
  }
}

function webHost(baseUrl: string): string {
  try { return new URL(baseUrl).hostname } catch { return baseUrl }
}

/** Decode the JWT exp claim without validating signature (local freshness only). */
export function jwtExpiry(token: string): number | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : undefined
  } catch { return undefined }
}

function accountOrigin(baseUrl: string): string {
  const url = new URL(baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`)
  if (url.search || url.hash || url.username || url.password) throw new Error('账号服务地址无效')
  return baseUrl
}

export class AccountLogin {
  readonly config: ServerConfig
  readonly origin: string
  readonly token: string
  readonly expiry: number | undefined
  readonly user: AccountUser
  readonly rawUserInfo: Record<string, unknown>
  #fetch: typeof fetch
  #lifetime = new AbortController()

  private constructor(config: ServerConfig, token: string, user: AccountUser, rawUserInfo: Record<string, unknown>, request: typeof fetch, expiry?: number) {
    this.config = Object.freeze({ ...config })
    this.origin = accountOrigin(config.baseUrl)
    this.token = token
    this.expiry = expiry ?? jwtExpiry(token)
    this.user = Object.freeze({ ...user })
    this.rawUserInfo = Object.freeze({ ...rawUserInfo })
    this.#fetch = request
  }

  static async login(config: ServerConfig, username: string, password: string, request: typeof fetch = fetch): Promise<AccountLogin> {
    const origin = accountOrigin(config.baseUrl)
    if (!username || !password || username.length > 254 || password.length > 512) throw new Error('请输入账号和密码')
    const response = await request(`${origin}${config.loginPath}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new Error('无法连接账号服务，请检查地址和网络') })
    if (!response.ok) throw new Error(response.status === 401 ? '账号或密码不正确' : `账号服务响应异常 (${response.status})`)
    const data: unknown = await response.json()
    const body = data as { code?: unknown, message?: unknown, result?: { token?: unknown, userInfo?: unknown }, ok?: boolean }
    const ok = body?.code === 200 || body?.ok === true
    if (!ok) {
      const message = typeof body?.message === 'string' && body.message ? body.message : '登录被拒绝'
      throw new Error(message)
    }
    const result = body.result
    if (!result || typeof result.token !== 'string' || !result.token || !result.userInfo || typeof result.userInfo !== 'object' || Array.isArray(result.userInfo)) {
      throw new Error('账号服务登录响应无效')
    }
    const user = accountUser(origin, result.userInfo as Record<string, unknown>)
    return new AccountLogin(config, result.token, user, result.userInfo as Record<string, unknown>, request)
  }

  /** True when the JWT carries an exp and it is already past. Opaque tokens always assumed live. */
  isExpired(now = Date.now()): boolean {
    return this.expiry !== undefined && this.expiry * 1000 <= now
  }

  /** POST the stored token to the configured logout endpoint. */
  async logout(): Promise<boolean> {
    try {
      const response = await this.#fetch(`${this.origin}${this.config.logoutPath}`, {
        method: 'POST', headers: { 'X-Access-Token': this.token }, redirect: 'error', signal: AbortSignal.timeout(10_000),
      })
      return response.ok || response.status === 401
    } catch { return false }
  }

  seal(): AccountSession {
    return { token: this.token, ...(this.expiry === undefined ? {} : { expiry: this.expiry }), user: { ...this.user }, rawUserInfo: { ...this.rawUserInfo } }
  }

  /** Restore a prior login from its decrypted store. Expiry defaults to the JWT's own exp. */
  static restore(config: ServerConfig, user: AccountUser, token: string, expiry: number | undefined, rawUserInfo: Record<string, unknown>, request: typeof fetch = fetch): AccountLogin {
    return new AccountLogin(config, token, user, rawUserInfo, request, expiry)
  }

  cancelRequests(): void { this.#lifetime.abort() }
}

export interface AccountAuthority {
  url: string
  key: string
  close(): Promise<void>
}

/**
 * 会话封包：记录本次用了哪种加密，读回时据此选择解密方式。
 * `os` 走系统级加密（Windows DPAPI / Linux 密钥环），`file` 走本机密钥文件。
 */
interface SealedSession {
  readonly v: 2
  readonly method: 'os' | 'file'
  readonly payload: string
}

/**
 * macOS 上不用 Electron safeStorage：它走钥匙串条目「<AppName> Safe Storage」，
 * 条目属于别的签名时读取会向用户弹授权框；而用 `security` CLI 重建的条目又因 macOS 的
 * 分区(partition)限制被应用本身拒绝（EACCES），两条路都无法做到“无感保存”。
 * 因此 macOS 一律使用本机密钥文件：32 字节随机密钥 + AES-256-GCM，密钥文件权限 0600。
 * 安全边界仍是“只有本机当前用户可解密”，但登录与记住登录全程不再有任何系统弹窗。
 * 其他平台继续使用系统级加密（Windows DPAPI、Linux 密钥环），它们本来就是静默的。
 */
function useSystemEncryption(): boolean {
  if (process.platform === 'darwin') return false
  return typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()
}

function keyFilePath(userData: string): string {
  return join(userData, KEY_FILENAME)
}

function readKeyFile(userData: string): Buffer | undefined {
  const file = keyFilePath(userData)
  if (!existsSync(file)) return undefined
  const value = readFileSync(file)
  return value.length === 32 ? value : undefined
}

/** 加密用的本机密钥：首次写入时生成，之后复用。 */
function requireKeyFile(userData: string): Buffer {
  const existing = readKeyFile(userData)
  if (existing) return existing
  const created = randomBytes(32)
  mkdirSync(userData, { recursive: true })
  writeFileSync(keyFilePath(userData), created, { mode: 0o600 })
  return created
}

function sealSession(userData: string, text: string): SealedSession {
  if (useSystemEncryption()) {
    return { v: 2, method: 'os', payload: safeStorage.encryptString(text).toString('base64') }
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', requireKeyFile(userData), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return { v: 2, method: 'file', payload: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64') }
}

function openSession(userData: string, sealed: SealedSession): string {
  const raw = Buffer.from(sealed.payload, 'base64')
  if (sealed.method === 'os') {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('decrypt-unavailable')
    return safeStorage.decryptString(raw)
  }
  const key = readKeyFile(userData)
  if (!key || raw.length <= 28) throw new Error('bad-session')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

/** Persist/recover the encrypted account session. No keychain dialog on any platform. */
export class AccountStore {
  private readonly file: string
  private readonly userData: string
  constructor(userData: string) {
    this.userData = userData
    this.file = join(userData, SESSION_FILENAME)
  }

  write(session: AccountSession): void {
    mkdirSync(this.userData, { recursive: true })
    writeFileSync(this.file, JSON.stringify(sealSession(this.userData, JSON.stringify(session))), { mode: 0o600 })
  }

  read(): { session: AccountSession, user: AccountUser, token: string } | undefined {
    if (!existsSync(this.file)) return undefined
    try {
      const envelope = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SealedSession>
      if (envelope?.v !== 2 || (envelope.method !== 'os' && envelope.method !== 'file') || typeof envelope.payload !== 'string') throw new Error('bad-session')
      const parsed = JSON.parse(openSession(this.userData, envelope as SealedSession)) as Partial<AccountSession>
      if (typeof parsed.token !== 'string' || !parsed.token || !parsed.user || typeof parsed.user !== 'object') throw new Error('bad-session')
      const user = parsed.user as AccountUser
      if (typeof user.userId !== 'string' || typeof user.username !== 'string' || typeof user.displayName !== 'string') throw new Error('bad-user')
      const token = parsed.token
      const expiry = typeof parsed.expiry === 'number' ? parsed.expiry : undefined
      const rawUserInfo = (parsed.rawUserInfo && typeof parsed.rawUserInfo === 'object') ? parsed.rawUserInfo as Record<string, unknown> : {}
      return { session: { token, ...(expiry === undefined ? {} : { expiry }), user, rawUserInfo }, user, token }
    } catch {
      // 解不开就丢弃旧会话，让用户重新登录；不把加密失败升级成启动失败。
      this.clear()
      return undefined
    }
  }

  clear(): void { rmSync(this.file, { force: true }) }
}

/** Restore a previous login purely from its store (already decrypted). */
export function restoreAccountLogin(config: ServerConfig, user: AccountUser, token: string, expiry: number | undefined, rawUserInfo: Record<string, unknown>): AccountLogin {
  return AccountLogin.restore(config, user, token, expiry, rawUserInfo, fetch)
}

/**
 * A capability-protected loopback bridge for the DSH account provider. It answers
 * identity queries and logout; the bearer token stays in this main process.
 */
export async function startAccountAuthority(login: AccountLogin, onLogout: () => void, onInvalid: () => void): Promise<AccountAuthority> {
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
    if (url.pathname === '/auth/me' && req.method === 'GET' && !url.search) {
      if (login.isExpired()) { closing = true; reject(401, 'Account authorization expired'); setImmediate(onInvalid); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ...login.user, principalId: login.user.userId, backendUrl: login.origin, mustChangePassword: false, desktop: true }))
      return
    }
    reject(404, 'Unknown Desktop operation')
  })
  server.requestTimeout = 15_000; server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() }) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Desktop account authority did not start')
  return { url: `http://127.0.0.1:${address.port}`, key, close: async () => { closing = true; login.cancelRequests(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}