import { readProtectedFile } from './protected-file.js';
import { isAbsolute } from 'node:path';
import type { MembershipRole } from 'workdsh-contracts';
import type { VerifiedAccount } from './request-context.js';

export interface AccountDesktopConfig {
  authFile: string;
  principalId: string;
  organizationId: string;
  deviceId: string;
}
interface AuthorityFile extends Omit<AccountDesktopConfig, 'authFile'> {
  authorityUrl: string;
  authorityKey: string;
  backendUrl: string;
}
/** Account surfaced on the official same-origin /api/auth/me route. */
export interface AccountAt {
  id: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  username?: string;
  /** 后端头像地址（可为相对路径）；缺省表示未设置，由客户端回退首字头像。 */
  avatar?: string;
  role: MembershipRole;
  mustChangePassword: false;
  deviceId: string;
  backendUrl: string;
}
export class DesktopAuthorityError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);

/** Main-owned capability to the Electron Main loopback authority. No backend token leaves Main. */
export class DesktopAuthority {
  private binding?: Readonly<AuthorityFile>;
  private readonly lifetime = new AbortController();
  constructor(readonly config: Readonly<AccountDesktopConfig>) {
    if (!isAbsolute(config.authFile) || !identifier(config.principalId) || !identifier(config.organizationId) || !identifier(config.deviceId))
      throw new Error('Account Desktop requires a protected authFile and fixed user, organization and device');
  }
  close(): void { this.lifetime.abort(); }
  private async credentials(): Promise<Readonly<AuthorityFile>> {
    const value = JSON.parse(await readProtectedFile(this.config.authFile, 8192)) as AuthorityFile;
    if (value.principalId !== this.config.principalId || value.organizationId !== this.config.organizationId || value.deviceId !== this.config.deviceId ||
        typeof value.authorityKey !== 'string' || !/^[a-f0-9]{64,128}$/i.test(value.authorityKey) || typeof value.backendUrl !== 'string' || !value.backendUrl)
      throw new Error('Account Desktop authority binding mismatch');
    const url = new URL(value.authorityUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash)
      throw new Error('Account Desktop authority must be a literal loopback origin');
    const normalized = Object.freeze({ authorityUrl: url.origin, authorityKey: value.authorityKey,
      backendUrl: value.backendUrl, principalId: value.principalId, organizationId: value.organizationId, deviceId: value.deviceId });
    if (this.binding && JSON.stringify(this.binding) !== JSON.stringify(normalized)) throw new Error('Account Desktop authority changed; sign in again');
    return this.binding ??= normalized;
  }
  private async request(path: string, method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal): Promise<unknown> {
    this.lifetime.signal.throwIfAborted(); signal?.throwIfAborted();
    const binding = await this.credentials();
    try {
      const response = await fetch(new URL(path, binding.authorityUrl), { method, redirect: 'error',
        headers: { authorization: `Bearer ${binding.authorityKey}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]) });
      if (!response.ok) throw new DesktopAuthorityError(`Account Desktop request rejected (${response.status})`, response.status);
      const value: unknown = await response.json();
      if (path !== '/auth/logout') await this.credentials();
      this.lifetime.signal.throwIfAborted(); signal?.throwIfAborted();
      return value;
    } catch (error) {
      if (error instanceof DesktopAuthorityError) throw error;
      throw new DesktopAuthorityError('Account Desktop authority unavailable or changed');
    }
  }
  async account(signal?: AbortSignal): Promise<AccountAt> {
    const value = await this.request('/auth/me', 'GET', undefined, signal) as Partial<AccountAt> & { principalId?: unknown };
    if (value.principalId !== this.config.principalId || value.organizationId !== this.config.organizationId ||
        typeof value.backendUrl !== 'string' || value.backendUrl !== this.binding?.backendUrl || value.mustChangePassword !== false ||
        typeof value.displayName !== 'string' || !value.displayName || typeof value.organizationName !== 'string' || !value.organizationName ||
        typeof value.role !== 'string' || !['owner', 'admin', 'member'].includes(value.role))
      throw new DesktopAuthorityError('Account user changed or authentication expired');
    return {
      id: this.config.principalId, organizationId: this.config.organizationId, organizationName: value.organizationName,
      displayName: value.displayName,
      ...(typeof value.username === 'string' && value.username ? { username: value.username } : {}),
      ...(typeof value.avatar === 'string' && value.avatar ? { avatar: value.avatar } : {}),
      role: value.role as MembershipRole, mustChangePassword: false, deviceId: this.config.deviceId, backendUrl: value.backendUrl,
    };
  }
  async verify(signal?: AbortSignal): Promise<VerifiedAccount> {
    const account = await this.account(signal);
    return { principalId: account.id, organizationId: account.organizationId, organizationName: account.organizationName,
      displayName: account.displayName, active: true, role: account.role };
  }
  /**
   * 通用业务后台通道按需索取的绑定：后台根地址 + 裸 JWT。
   *
   * 令牌来自 Main 回环桥的只读路由 `/auth/backend-binding`：它是被校验的登录态的直接产物，
   * 不是受保护 auth 文件里的 `authorityKey`（那是 64–128 位 hex 能力，只允许调用本机桥的
   * 封闭路由）。因此令牌仍然只存在于 Electron Main 内存，由本方法每次按需获取、
   * 不缓存、不写入任何 Host 持久化状态，也不进入任何渲染层响应。
   *
   * 顺序固定为「先复验绑定记录，再复验登录态，最后取令牌」：受保护文件被替换或绑定变更时
   * 报绑定错误，登录过期或回包结构不符时报明确的失败，绝不静默降级为可用。
   */
  async backendBinding(signal?: AbortSignal): Promise<{ url: string; authorization: string }> {
    signal?.throwIfAborted();
    // 先确认绑定记录本身仍然完好：受保护文件被替换或绑定变更时，报错必须指向绑定而不是令牌通道。
    const binding = await this.credentials();
    let value: unknown;
    try {
      // 再复验登录态，最后才取令牌：Main 只在登录态有效时下发绑定。
      await this.account(signal);
      value = await this.request('/auth/backend-binding', 'GET', undefined, signal);
    } catch (error) {
      // 401 表示 Main 判定登录态已失效：给出明确失败，而不是把过期令牌当成可用绑定。
      if (error instanceof DesktopAuthorityError && error.status === 401)
        throw new DesktopAuthorityError('Account Desktop sign-in expired; sign in again', 401);
      throw error;
    }
    const record = (value ?? {}) as { url?: unknown, authorization?: unknown };
    const url = typeof record.url === 'string' ? record.url : undefined;
    // 后台地址必须与绑定记录一致；授权值必须是非空字符串。错误消息只描述结论，不回显令牌或地址。
    if (url === undefined || url !== binding.backendUrl || typeof record.authorization !== 'string' || !record.authorization)
      throw new DesktopAuthorityError('Account Desktop backend binding is invalid');
    return { url, authorization: record.authorization };
  }
  /**
   * 通知 Main：一次成员身份的请求被后台判定为未授权（HTTP 401 或信封 code 401）。
   *
   * 与只读的 `backendBinding()` 不同，这条回环路由**有副作用**：Main 会执行与轮询一致的
   * 失效收尾（弹「账号登录已失效」提示并退回登录页），因此只能由持有本机 `authorityKey`
   * 的能力方调用。调用成功与否都不影响调用方原有的 401 判定，失效通知是尽力而为。
   */
  async unauthorized(signal?: AbortSignal): Promise<void> {
    await this.request('/auth/backend-unauthorized', 'POST', {}, signal);
  }
  async logout(signal?: AbortSignal): Promise<{ local: true }> {
    // Main owns local stop/cleanup even when backend revocation cannot be confirmed.
    const value = await this.request('/auth/logout', 'POST', {}, signal) as { local?: boolean };
    if (value?.local !== true) throw new Error('Account Desktop logout response invalid');
    this.close(); return { local: true };
  }
}