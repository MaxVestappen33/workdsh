import { parseWorkbenchSystemDefinition, type WorkbenchSystemDefinition } from './workbench-system.js';
import type { ActorContext, ResourceOwner } from './governance.js';

/** WorkDSH protocol version, independent of product, kernel and plugin versions. */
export const WORKBENCH_PROTOCOL_VERSION = '1.0' as const;
export interface WorkbenchRequirementsDraft {
  readonly title: string;
  readonly scenario: string;
  readonly users: string;
  readonly dataSources: string;
  readonly workflow: string;
  readonly firstIteration: string;
  readonly acceptance: string;
  readonly system?: WorkbenchSystemDefinition;
}
export interface WorkbenchRequirementsRevision {
  readonly id: string;
  readonly developmentId: string;
  readonly parentRevisionId?: string;
  readonly owner: ResourceOwner;
  readonly requirements: WorkbenchRequirementsDraft;
  readonly createdAt: string;
  readonly createdBy: string;
}
/** Shared by the page and Host; page validation alone is insufficient. */
export function parseWorkbenchRequirementsDraft(value: unknown): WorkbenchRequirementsDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('workbench/invalid-requirements');
  const input = value as Record<string, unknown>;
  const result = {} as Record<keyof Omit<WorkbenchRequirementsDraft, 'system'>, string>;
  for (const key of ['title', 'scenario', 'users', 'dataSources', 'workflow', 'firstIteration', 'acceptance'] as const) {
    const text = input[key];
    if (typeof text !== 'string' || !text.trim() || text.length > (key === 'title' ? 80 : 8000)) throw new Error('workbench/invalid-requirements');
    result[key] = text.trim();
  }
  return Object.freeze({ ...result, ...(input.system === undefined ? {} : { system: parseWorkbenchSystemDefinition(input.system) }) });
}
export type WorkbenchCapability = 'project.read' | 'project.link' | 'library.read' | 'library.write' | 'skill.select' | 'expert.select' | 'connector.invoke' | 'ai.draft' | 'enterprise.quality.read';
export interface WorkbenchDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly protocolVersion: typeof WORKBENCH_PROTOCOL_VERSION;
  readonly layout: 'full-page';
  readonly hostCompatibility: { readonly sdk: string; readonly harness: string };
  readonly capabilities: readonly WorkbenchCapability[];
  readonly repository?: string;
}

/** Resolved by the Host; a plugin/page cannot establish its own installation identity. */
export interface WorkbenchInstallationRef {
  readonly hostId: string;
  readonly installationId: string;
  readonly profileId: string;
  readonly harnessVersion: string;
}
export interface WorkbenchPackageReceipt {
  readonly packageName: string;
  readonly version: string;
  readonly sha256: string;
}
export interface WorkbenchInventoryEntry {
  readonly descriptor: WorkbenchDescriptor;
  readonly target: WorkbenchInstallationRef;
  readonly installed: WorkbenchPackageReceipt;
  readonly active?: WorkbenchPackageReceipt;
  /** Derived from official package state, never a second enable/disable flag. */
  readonly state: 'enabled' | 'disabled' | 'pending-restart' | 'incompatible' | 'failed';
  readonly unavailableCapabilities: readonly WorkbenchCapability[];
  readonly errorCode?: string;
}

/** Business ownership remains independent of development and installation ownership. */
export interface WorkbenchRecord {
  readonly id: string;
  readonly workbenchId: string;
  readonly owner: ResourceOwner;
  readonly projectId?: string;
  readonly title: string;
  readonly revision: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export type WorkbenchDevelopmentState = 'requirements' | 'ready' | 'developing' | 'built' | 'pending-install' | 'pending-restart' | 'trial' | 'changes-requested' | 'accepted' | 'interrupted' | 'failed';
export interface WorkbenchDevelopment {
  readonly id: string;
  readonly workbenchId: string;
  readonly packageName: string;
  readonly owner: ResourceOwner;
  readonly revision: string;
  readonly requirementsRevision: string;
  readonly iterationId: string;
  readonly target: WorkbenchInstallationRef;
  readonly state: WorkbenchDevelopmentState;
  readonly source?: { readonly hostId: string; readonly directory: string; readonly revision: string };
  /** Host-verified native Session reference, scoped to this installation. */
  readonly session?: { readonly hostId: string; readonly sessionId: string };
  readonly candidate?: WorkbenchPackageReceipt;
  readonly installed?: WorkbenchPackageReceipt;
  readonly active?: WorkbenchPackageReceipt;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface WorkbenchDevelopmentIndexEntry {
  readonly title: string;
  readonly development: WorkbenchDevelopment;
}

export interface WorkbenchDevelopmentOperation {
  readonly id: string;
  readonly revision: string;
  /** Hash of immutable, non-secret operation inputs, supplied by the trusted Host adapter. */
  readonly inputHash: string;
  readonly developmentId: string;
  readonly iterationId: string;
  readonly actor: ActorContext;
  readonly target: WorkbenchInstallationRef;
  readonly kind: 'create-session' | 'build' | 'install' | 'update' | 'migrate';
  readonly state: 'intent' | 'running' | 'reconciling' | 'unknown' | 'succeeded' | 'failed';
  /** Captured import identity, retained with intent for recovery after restart. */
  readonly candidate?: WorkbenchPackageReceipt & { readonly workbenchId: string };
  readonly expectedInstalledHash?: string;
  readonly receipt?: { readonly sessionId?: string; readonly package?: WorkbenchPackageReceipt; readonly pendingRestart: boolean };
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkbenchCapabilityAvailability {
  readonly capability: WorkbenchCapability;
  readonly state: 'available' | 'module-missing' | 'login-required' | 'forbidden' | 'backend-unimplemented' | 'unsupported-host';
}
export interface WorkbenchCapabilityDescription {
  readonly protocolVersion: typeof WORKBENCH_PROTOCOL_VERSION;
  readonly sdkVersion: string;
  readonly harnessVersion: string;
  readonly target: WorkbenchInstallationRef;
  readonly capabilities: readonly WorkbenchCapabilityAvailability[];
}

const capabilities: ReadonlySet<string> = new Set<WorkbenchCapability>(['project.read', 'project.link', 'library.read', 'library.write', 'skill.select', 'expert.select', 'connector.invoke', 'ai.draft', 'enterprise.quality.read']);
/** Runtime validation for static declarations and registration. Does not authorize access. */
export function assertWorkbenchDescriptor(value: unknown): asserts value is WorkbenchDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('workbench/invalid-descriptor');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(row.id) || row.id.length > 128) throw new Error('workbench/invalid-id');
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 80 || typeof row.description !== 'string' || row.description.length > 1000) throw new Error('workbench/invalid-descriptor');
  if (row.protocolVersion !== WORKBENCH_PROTOCOL_VERSION) throw new Error('workbench/incompatible-protocol');
  if (row.layout !== 'full-page') throw new Error('workbench/unsupported-layout');
  const compatibility = row.hostCompatibility;
  if (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility)) throw new Error('workbench/invalid-compatibility');
  for (const key of ['sdk', 'harness']) {
    const range = (compatibility as Record<string, unknown>)[key];
    if (typeof range !== 'string' || !range.trim() || range.length > 128) throw new Error('workbench/invalid-compatibility');
  }
  if (!Array.isArray(row.capabilities) || row.capabilities.some(item => typeof item !== 'string' || !capabilities.has(item)) || new Set(row.capabilities).size !== row.capabilities.length) throw new Error('workbench/invalid-capabilities');
  if (row.repository !== undefined) {
    try {
      if (typeof row.repository !== 'string') throw new Error();
      const url = new URL(row.repository);
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw new Error();
    } catch { throw new Error('workbench/invalid-repository'); }
  }
}

/** Own a validated immutable copy; never retain the caller's mutable registration object. */
export function parseWorkbenchDescriptor(value: unknown): WorkbenchDescriptor {
  assertWorkbenchDescriptor(value);
  return Object.freeze({
    id: value.id,
    title: value.title.trim(),
    description: value.description,
    protocolVersion: value.protocolVersion,
    layout: value.layout,
    hostCompatibility: Object.freeze({ sdk: value.hostCompatibility.sdk, harness: value.hostCompatibility.harness }),
    capabilities: Object.freeze([...value.capabilities]),
    ...(value.repository === undefined ? {} : { repository: value.repository }),
  });
}

/** Compare separately observed installation and runtime facts. Never treats a build as installed. */
export function workbenchActivationState(input: {
  readonly installed: WorkbenchPackageReceipt;
  readonly active?: WorkbenchPackageReceipt;
  readonly enabled: boolean;
  readonly compatible: boolean;
  readonly activationError?: string;
}): WorkbenchInventoryEntry['state'] {
  const validate = (receipt: WorkbenchPackageReceipt) => {
    if (!receipt || typeof receipt.packageName !== 'string' || !receipt.packageName || typeof receipt.version !== 'string' || !receipt.version || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error('workbench/invalid-package-receipt');
  };
  validate(input.installed);
  if (input.active) validate(input.active);
  // A disabled package with a live registration has not finished disabling.
  if (!input.enabled) return input.active ? 'pending-restart' : 'disabled';
  if (!input.compatible) return 'incompatible';
  if (input.activationError) return 'failed';
  if (!input.active || input.active.packageName !== input.installed.packageName || input.active.version !== input.installed.version || input.active.sha256 !== input.installed.sha256) return 'pending-restart';
  return 'enabled';
}

/** Decode the development API's member-owned v1 index. This validates shape,
 * never establishes authorization or proves a claimed installation receipt.
 */
export function parseWorkbenchDevelopmentIndexEntry(value: unknown): WorkbenchDevelopmentIndexEntry {
  const record = (item: unknown): Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('workbench/invalid-development-entry');
    return item as Record<string, unknown>;
  };
  const text = (item: unknown, max = 256): string => {
    if (typeof item !== 'string' || !item.trim() || item.length > max || /[\u0000-\u001f]/.test(item)) throw new Error('workbench/invalid-development-entry');
    return item;
  };
  const date = (item: unknown) => {
    const result = text(item);
    if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new Error('workbench/invalid-development-entry');
    return result;
  };
  const entry = record(value), input = record(entry.development), owner = record(input.owner), target = record(input.target);
  if (owner.scope !== 'personal') throw new Error('workbench/invalid-development-entry');
  const state = text(input.state) as WorkbenchDevelopmentState;
  if (!['requirements', 'ready', 'developing', 'built', 'pending-install', 'pending-restart', 'trial', 'changes-requested', 'accepted', 'interrupted', 'failed'].includes(state)) throw new Error('workbench/invalid-development-entry');
  const packageName = text(input.packageName, 214);
  const receipt = (item: unknown): WorkbenchPackageReceipt => {
    const source = record(item);
    const result = Object.freeze({ packageName: text(source.packageName, 214), version: text(source.version), sha256: text(source.sha256, 64) });
    workbenchActivationState({ installed: result, enabled: false, compatible: true });
    if (result.packageName !== packageName) throw new Error('workbench/invalid-development-entry');
    return result;
  };
  const source = input.source === undefined ? undefined : record(input.source);
  const session = input.session === undefined ? undefined : record(input.session);
  if (session && text(session.hostId, 128) !== text(target.hostId, 128)) throw new Error('workbench/invalid-development-entry');
  return Object.freeze({ title: text(entry.title, 80), development: Object.freeze({
    id: text(input.id, 128), workbenchId: text(input.workbenchId, 128), packageName,
    owner: Object.freeze({ organizationId: text(owner.organizationId), ownerPrincipalId: text(owner.ownerPrincipalId), scope: 'personal' as const }),
    revision: text(input.revision, 128), requirementsRevision: text(input.requirementsRevision, 128), iterationId: text(input.iterationId, 128), state,
    target: Object.freeze({ hostId: text(target.hostId, 128), installationId: text(target.installationId, 128), profileId: text(target.profileId, 128), harnessVersion: text(target.harnessVersion, 128) }),
    ...(source === undefined ? {} : { source: Object.freeze({ hostId: text(source.hostId, 128), directory: text(source.directory, 8192), revision: text(source.revision) }) }),
    ...(session === undefined ? {} : { session: Object.freeze({ hostId: text(session.hostId, 128), sessionId: text(session.sessionId, 128) }) }),
    ...(input.candidate === undefined ? {} : { candidate: receipt(input.candidate) }),
    ...(input.installed === undefined ? {} : { installed: receipt(input.installed) }),
    ...(input.active === undefined ? {} : { active: receipt(input.active) }),
    createdAt: date(input.createdAt), updatedAt: date(input.updatedAt),
  }) });
}
