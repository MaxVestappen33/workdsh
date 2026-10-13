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
      role: value.role as MembershipRole, mustChangePassword: false, deviceId: this.config.deviceId, backendUrl: value.backendUrl,
    };
  }
  async verify(signal?: AbortSignal): Promise<VerifiedAccount> {
    const account = await this.account(signal);
    return { principalId: account.id, organizationId: account.organizationId, organizationName: account.organizationName,
      displayName: account.displayName, active: true, role: account.role };
  }
  async logout(signal?: AbortSignal): Promise<{ local: true }> {
    // Main owns local stop/cleanup even when backend revocation cannot be confirmed.
    const value = await this.request('/auth/logout', 'POST', {}, signal) as { local?: boolean };
    if (value?.local !== true) throw new Error('Account Desktop logout response invalid');
    this.close(); return { local: true };
  }
}