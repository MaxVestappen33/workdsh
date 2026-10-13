import { randomUUID } from 'node:crypto';
import type { ActorContext, IdentityProfile, IdentityResolutionContext, IdentityService, Membership } from 'workdsh-contracts';
import type { VerifiedAccount } from './request-context.js';

/** Login-verified account identity, re-verified against Main on every resolve. */
export class AccountIdentity implements IdentityService {
  readonly id = 'workdsh-account-member';
  private revoked = false;
  private readonly revision = randomUUID();
  private constructor(
    private readonly account: VerifiedAccount,
    private readonly verify: (signal?: AbortSignal) => Promise<VerifiedAccount>,
  ) {}

  static async admit(verify: (signal?: AbortSignal) => Promise<VerifiedAccount>, signal?: AbortSignal): Promise<AccountIdentity> {
    signal?.throwIfAborted();
    const account = await verify(signal);
    signal?.throwIfAborted();
    if (!account.active || !account.organizationId || !account.principalId || !account.role) throw new Error('Account authentication required');
    return new AccountIdentity(Object.freeze({ ...account }), verify);
  }
  revoke(): void { this.revoked = true; }
  private check(): void { if (this.revoked) throw new Error('Account identity expired'); }

  profile(): IdentityProfile {
    this.check();
    const membership: Membership = Object.freeze({
      organizationId: this.account.organizationId, principalId: this.account.principalId,
      principalKind: 'human', role: this.account.role!, state: 'active', revision: this.revision,
    });
    return Object.freeze({
      principalId: this.account.principalId, principalKind: 'human', resolvedBy: this.id,
      organization: Object.freeze({ id: this.account.organizationId, kind: 'team', name: this.account.organizationName || '账号空间', revision: this.revision }),
      membership,
    });
  }
  membership(organizationId: string, principalId: string): Membership | undefined {
    const profile = this.profile();
    return organizationId === this.account.organizationId && principalId === this.account.principalId ? profile.membership : undefined;
  }
  async resolve(evidence?: IdentityResolutionContext, signal?: AbortSignal): Promise<ActorContext> {
    this.check(); signal?.throwIfAborted();
    let current: VerifiedAccount;
    try { current = await this.verify(signal); }
    catch (error) { if (!signal?.aborted) this.revoke(); throw error; }
    signal?.throwIfAborted(); this.check();
    if (!current.active || current.principalId !== this.account.principalId || current.organizationId !== this.account.organizationId) {
      this.revoke(); throw new Error('Account identity changed or expired');
    }
    return Object.freeze({
      principalId: this.account.principalId, organizationId: this.account.organizationId, resolvedBy: this.id, requestId: randomUUID(),
      ...(evidence?.sessionId === undefined ? {} : { sessionId: evidence.sessionId }),
      ...(evidence?.runId === undefined ? {} : { runId: evidence.runId }),
    });
  }
}