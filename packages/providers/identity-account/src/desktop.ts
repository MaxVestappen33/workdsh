import { Service, type Context } from '@deepseek-ai/cordis';
import type { IdentityResolutionContext, IdentityService } from 'workdsh-contracts';
import type {} from '@deepseek-ai/dsh-client-connection';
import { AccountIdentity } from './identity.js';
import { DesktopAuthority, type AccountDesktopConfig } from './desktop-authority.js';
export type { AccountDesktopConfig } from './desktop-authority.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshIdentity: IdentityService } }

/** Explicit account Desktop composition. It cannot authenticate as a personal identity. */
export default class AccountDesktopIdentity extends Service implements IdentityService {
  static inject = ['connection'];
  readonly id = 'workdsh-account-desktop';
  private identity?: AccountIdentity;
  private readonly authority: DesktopAuthority;

  constructor(ctx: Context, config: AccountDesktopConfig) {
    super(ctx, 'workdshIdentity');
    this.authority = new DesktopAuthority(Object.freeze({ ...config }));
    ctx.effect(() => () => { this.identity?.revoke(); this.authority.close(); }, 'workdsh.account-desktop.authority');
    const register = (path: string, methods: Array<'GET' | 'POST'>, fetch: (request: Request) => Promise<Response>) => {
      ctx.effect(() => ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch }),
        `workdsh.account-desktop.${path}`);
    };
    const denied = () => Response.json({ local: true, error: '账号认证未确认，请在桌面端重新登录。' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    register('/api/auth/me', ['GET'], async request => {
      try {
        await this.resolve(undefined, request.signal);
        const account = await this.authority.account(request.signal);
        return Response.json({ ...account, desktop: true }, { headers: { 'cache-control': 'no-store' } });
      } catch { this.identity?.revoke(); return denied(); }
    });
    register('/api/auth/logout', ['POST'], async request => {
      try {
        const value = await this.authority.logout(request.signal); this.identity?.revoke();
        return Response.json(value, { headers: { 'cache-control': 'no-store' } });
      } catch { this.identity?.revoke(); this.authority.close(); return denied(); }
    });
  }
  async [Service.init](): Promise<void> {
    this.identity = await AccountIdentity.admit(signal => this.authority.verify(signal));
  }
  profile() {
    if (!this.identity) throw new Error('Account Desktop authentication required');
    return this.identity.profile();
  }
  membership(organizationId: string, principalId: string) {
    return this.identity?.membership(organizationId, principalId);
  }
  async resolve(evidence?: IdentityResolutionContext, signal?: AbortSignal) {
    if (!this.identity) throw new Error('Account Desktop authentication required');
    return this.identity.resolve(evidence, signal);
  }
}