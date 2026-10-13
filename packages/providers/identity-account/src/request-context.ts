import type { MembershipRole } from 'workdsh-contracts';

/** Account identity verified against the Electron Main loopback authority. */
export interface VerifiedAccount {
  readonly principalId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly role?: MembershipRole;
}