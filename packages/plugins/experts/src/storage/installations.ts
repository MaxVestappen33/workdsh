import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { ExpertInstallation } from 'workdsh-contracts';
import { bounded, iso, resourceOwnerSchema } from './domain.js';

/**
 * Storage layout for the backend-installed experts (`workdsh_expert_installations`).
 *
 * Kept as its own domain so the existing expert tables keep their version: an
 * installation is only the link between a backend catalog row and the local
 * expert it produced. The expert, its drafts and revisions stay in
 * `workdsh_experts`, so Summon/readiness/immutability behave exactly as before.
 *
 * `per-record` keeps every installation independently addressable and rejects
 * invalid records instead of silently dropping them.
 */

const domainIssueSchema = z.object({
  code: z.string().min(1),
  path: z.string().optional(),
  message: z.string(),
  dependencyRef: z.string().optional(),
});

const installationSchema: z.ZodType<ExpertInstallation> = z.object({
  remoteKey: bounded,
  remoteId: bounded,
  expertType: z.enum(['agent', 'team']),
  expertId: bounded,
  version: bounded,
  fileName: bounded,
  sourceUrl: bounded,
  packageDigest: bounded.optional(),
  status: z.enum(['ready', 'missing-dependency', 'unavailable']),
  issues: z.array(domainIssueSchema),
  owner: resourceOwnerSchema,
  installedAt: iso,
  updatedAt: iso,
});

export const installationsDomainSpec = defineDomain({
  name: 'workdsh_expert_installations',
  version: 1,
  layout: 'per-record',
  tables: {
    installations: domainTable<string, ExpertInstallation>(installationSchema),
  },
});

/** `${expertType}-${remoteId}` is already path-safe; harden caller-supplied values. */
export function installationKey(expertType: string, remoteId: string): string {
  return `${expertType}-${remoteId}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
