import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { createScope } from '@deepseek-ai/dsh-scope';
import Tools from '@deepseek-ai/dsh-tools';
import { registerExpertManagementTools } from '../../../../packages/plugins/experts/dist/tools/management-tools.js';
import { FileSystem, LocalFileSystem, WorkingDirectory, createMessage, Agents, AgentLoop, Sessions, Projections, SystemPrompt, Llm, skillTool, SkillRequestAdapter } from '../helpers/skill-runtime.mjs';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem';

import { AccessManager } from '../../../../packages/plugins/access/dist/index.js';
import { AuditJournal } from '../../../../packages/plugins/audit/dist/index.js';
import { SkillManager } from '../../../../packages/plugins/skills/dist/index.js';
import { registerExpertsConnection } from '../../../../packages/plugins/experts/dist/services/connection-api.js';
import { ExpertsManager } from '../../../../packages/plugins/experts/dist/index.js';
import { registerExpertExecutionGuard } from '../../../../packages/plugins/experts/dist/runtime/execution-guard.js';
import { COMPILER_VERSION, compileExpertPreset, expertPersonaConfig, expertPresetDir, readExpertPreset } from '../../../../packages/plugins/experts/dist/runtime/preset-compiler.js';
import { definitionFromDocuments } from '../../../../packages/plugins/experts/dist/authoring/documents.js';
import { keys } from '../../../../packages/plugins/experts/dist/storage/domain.js';
import { buildExport } from '../../../../packages/plugins/experts/dist/services/portability.js';
import { createHash } from 'node:crypto';

test('authored expert package publishes complete MD and mounts retained bundled Skill resources', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const files = { '.workdsh-expert/plugin.json': JSON.stringify({ name: 'package-expert', expertType: 'agent', agentName: 'package-expert', agents: ['./agents/package-expert.md'], skills: ['./skills/bundled-method'] }), 'agents/package-expert.md': '---\nname: package-expert\ndescription: Package expert\nskills: [bundled-method]\n---\n# Professional framework\n\nComplete independent Agent Markdown.', 'skills/bundled-method/SKILL.md': '---\nname: bundled-method\ndescription: A retained method\n---\nRead references/domain.md.', 'skills/bundled-method/references/domain.md': 'Domain method preserved.' };
    const assets = { 'bin/inspect': { base64: Buffer.from('#!/bin/sh\necho inspect\n').toString('base64'), executable: true }, 'assets/table.bin': { base64: Buffer.from([0, 255, 1, 7]).toString('base64') } };
    const draft = await h.experts.createDraft(a, definitionFromDocuments(files, assets), { operationId: 'package-create' });
    const validation = await h.experts.validate(a, draft.expertId, draft.revision);
    assert.equal(validation.publishable, true, JSON.stringify(validation.issues));
    const request = await h.experts.requestPublishConfirmation(a, draft.expertId, draft.revision);
    const proof = await h.experts.confirmPublish(a, request.confirmationToken);
    const receipt = await h.experts.publish(a, draft.expertId, draft.revision, validation.dependencyLockDigest, proof, { operationId: 'package-publish' });
    const composition = await readExpertPreset(receipt.presetRevisionRef);
    assert.match(composition, /Complete independent Agent Markdown/);
    assert.match(composition, /expert-package\/skills\/bundled-method/);
    const published = await h.experts.get(a, draft.expertId);
    assert.deepEqual(published.revision.definition.packageDocuments, files);
    assert.equal(published.readiness, 'ready');
    await assert.rejects(h.experts.updateDraft(a, draft.expertId, { methodology: 'Ignored replacement' }, { operationId: 'package-summary-edit', expectedRevision: published.expert.revision }), error => error.code === 'experts/invalid-definition');
    const edited = { ...files, 'agents/package-expert.md': files['agents/package-expert.md'].replace('Complete independent', 'Updated independent') };
    const updated = await h.experts.updateDraft(a, draft.expertId, { packageDocuments: edited }, { operationId: 'package-files-edit', expectedRevision: published.expert.revision });
    const changedIdentity = { ...edited, '.workdsh-expert/plugin.json': JSON.stringify({ ...JSON.parse(edited['.workdsh-expert/plugin.json']), name: 'replacement-package' }) };
    await assert.rejects(h.experts.updateDraft(a, draft.expertId, { packageDocuments: changedIdentity }, { operationId: 'package-identity-rejected' }), error => error.code === 'experts/invalid-definition');
    assert.match(updated.definition.agentDocument, /Updated independent/);
    assert.match(updated.definition.methodology, /Updated independent/);
    assert.match((await h.experts.get(a, draft.expertId)).revision.definition.agentDocument, /Complete independent/);
    const root = dirname(expertPresetDir(receipt.presetRevisionRef));
    const cli = join(root, receipt.presetRevisionRef, 'expert-package/bin/inspect');
    assert.deepEqual(await readFile(cli), Buffer.from(assets['bin/inspect'].base64, 'base64'));
    assert.ok((await stat(cli)).mode & 0o111);
    const asset = join(root, receipt.presetRevisionRef, 'expert-package/assets/table.bin');
    await writeFile(asset, Buffer.from([0, 255, 2, 7]));
    assert.notEqual((await h.experts.get(a, draft.expertId)).readiness, 'ready');
    await writeFile(asset, Buffer.from(assets['assets/table.bin'].base64, 'base64'));
    assert.equal((await h.experts.get(a, draft.expertId)).readiness, 'ready');
    const resource = join(root, receipt.presetRevisionRef, 'expert-package/skills/bundled-method/references/domain.md');
    await writeFile(resource, 'Unexpected edited method');
    assert.notEqual((await h.experts.get(a, draft.expertId)).readiness, 'ready');
    await writeFile(resource, files['skills/bundled-method/references/domain.md']);
    assert.equal((await h.experts.get(a, draft.expertId)).readiness, 'ready');
    const added = join(root, receipt.presetRevisionRef, 'expert-package/skills/bundled-method/references/extra.md');
    await writeFile(added, 'Unpublished content');
    assert.notEqual((await h.experts.get(a, draft.expertId)).readiness, 'ready');
    await rm(added);
    assert.equal((await h.experts.get(a, draft.expertId)).readiness, 'ready');
  } finally { await h.cleanup(); }
});

// ── Host integration for the experts domain service (D04 / P1-02) ──────────────
//
// This exercises the REAL ExpertsManager against the REAL governance/storage/skill
// stack (Storage → JsonStorage → StorageDomain → AuditJournal → AccessManager and
// SkillRegistry → filesystem → SkillManager). Only three seams that the official
// Host owns at runtime are stubbed, each faithfully:
//   • agentPresets — delegates to the OFFICIAL authoring functions
//     (discoverPresets/readComposition/copyComposition) over the shipped preset root
//     plus a per-test writable user root, so experts compile to real preset dirs.
//   • sessionController / workdshSessionAccess — count native Session creates so we
//     can prove "at most one Session per operationId" without booting the agent loop.
//   • workdshIdentity — a membership directory, exactly like the access/audit tests.
// Coverage: AT-01 (list/search/filter/paging/visibility), AT-04 (authoring+validate+
// limits), AT-05 (CAS), AT-06 (confirmation-bound publish security), AT-07/08 (freeze
// Skill dependency, immutable revision, cold restart), AT-14 (default-immutable/copy/
// availability), AT-15 (cross-owner/org isolation, audit), AT-16 (publish idempotency),
// AT-17 (execution idempotency + handoff + binding), AT-22 (bad actor rejected).

const require_ = createRequire(import.meta.url);
// The base URL a preset row's package name resolves against. The real Host uses its
// own ctx.baseUrl (the installed harness); pointing at the installed `dsh` package
// makes the shipped presets resolve healthy exactly as they do at runtime.
const HARNESS_BASE = pathToFileURL(dirname(require_.resolve('@deepseek-ai/dsh/package.json')) + '/').href;

const MEMBERS = new Map([
  ['organization-a:owner-a', { organizationId: 'organization-a', principalId: 'owner-a', principalKind: 'human', role: 'owner', state: 'active', revision: 'm-owner-a' }],
  ['organization-a:member-a', { organizationId: 'organization-a', principalId: 'member-a', principalKind: 'human', role: 'member', state: 'active', revision: 'm-member-a' }],
  ['organization-b:owner-b', { organizationId: 'organization-b', principalId: 'owner-b', principalKind: 'human', role: 'owner', state: 'active', revision: 'm-owner-b' }],
]);

function createIdentity() {
  return {
    id: 'experts-test-identity',
    async resolve() { throw new Error('resolve() is not used by these Host-side tests'); },
    profile() { throw new Error('profile() is not used by these Host-side tests'); },
    membership(organizationId, principalId) { return MEMBERS.get(`${organizationId}:${principalId}`); },
  };
}

let requestCounter = 0;
function actor(principalId, organizationId = 'organization-a') {
  requestCounter += 1;
  return { principalId, organizationId, requestId: `req-${principalId}-${requestCounter}`, resolvedBy: 'experts-test-identity' };
}

/** A complete, structurally valid definition (publishable with no Skill dependency). */
function fullDefinition(name, overrides = {}) {
  return {
    name,
    description: 'A test expert used by the Host integration suite.',
    role: 'You are a precise test expert with a clear role.',
    methodology: 'Work step by step and verify each result before continuing.',
    boundaries: 'Stay inside the stated scope and never invent facts.',
    deliverables: 'A concise, verifiable result the user can check.',
    tags: ['test'],
    examples: [{ id: 'ex-1', title: 'First example', prompt: 'Do the test thing and report the result.' }],
    skillRequirements: [],
    futureRequirements: [],
    ...overrides,
  };
}

/**
 * Boot the real Host stack over an isolated temp home. Pass `existingRoot` to re-open
 * a previously used home (cold-restart test); the returned `cleanup` only removes a
 * root this call created.
 */
async function boot(existingRoot, { profileAgents = false, connectors, seedDefaults = true, requireInstalledExpert = false } = {}) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'workdsh-experts-'));
  const dshHome = join(root, 'dsh');
  const agentsHome = profileAgents ? join(dshHome, 'agents') : join(root, 'agents');
  const storageRoot = join(root, 'storage');
  const userPresetRoot = join(agentsHome, '.agent-presets');
  const savedAgentsHome = process.env.DSH_AGENTS_HOME;
  const savedDshHome = process.env.DSH_HOME;
  if (profileAgents) delete process.env.DSH_AGENTS_HOME; else process.env.DSH_AGENTS_HOME = agentsHome;
  process.env.DSH_HOME = dshHome;

  // A real local Skill so an expert can freeze an explicit dependency (AT-07/08).
  if (!existingRoot) {
    const skillDir = join(agentsHome, 'skills', 'sample-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: sample-skill\ndescription: Expert dependency fixture\n---\nUse this fixture when the expert needs it.\n');
  }

  const ctx = new Context();
  ctx.provide('agentTeams', { tryMembership: () => undefined });
  const createCalls = [];
  try {
    ctx.provide('workdshIdentity', createIdentity());
    if (connectors) ctx.provide('workdshConnectors', connectors);
    await ctx.plugin(Storage);
    await ctx.plugin(JsonStorage, { root: storageRoot });
    await ctx.plugin(StorageDomain, { backend: 'json' });
    await ctx.plugin(AuditJournal);
    await ctx.plugin(AccessManager);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(filesystem, { dshHome, agentsHome, watch: false });
    new SkillManager(ctx);

    const definitions = new Map([['standard', { id: 'standard', plugins: [] }], ['ptc', { id: 'ptc', plugins: [] }]]);
    ctx.provide('loader', { *entries() { yield { disabled: false, options: { name: '@deepseek-ai/dsh-agent-preset', config: definitions.get('standard') } }; } });
    ctx.provide('agentPresets', {
      get defaultId() { return 'standard'; },
      async register(definition) { definitions.set(definition.id, definition); return async () => { definitions.delete(definition.id); }; },
      async list() { return [...definitions.values()].map(({ id, name }) => ({ id, name })); },
      async resolve(id = 'standard') {
        const row = (await this.list()).find(row => row.id === id);
        if (!row) throw Object.assign(new Error(`agent-preset/not-found: ${id}`), { code: 'agent-preset/not-found' });
        return row;
      },
    });
    ctx.provide('sessionController', {
      async inspect(sessionId) { throw Object.assign(new Error(`session/not-found: ${sessionId}`), { code: 'session/not-found' }); },
      async create(request) { createCalls.push(String(request.sessionId)); return { sessionId: request.sessionId }; },
      async resolveAgent(sessionId) { return { agent: { id: String(sessionId) } }; },
      async selectModel() { /* not exercised: tests pass no modelSelection */ },
    });
    ctx.provide('workdshSessionAccess', {
      async create(request) { createCalls.push(String(request.sessionId)); return { sessionId: request.sessionId }; },
    });

    // ctx.plugin awaits the async [Service.init] that opens the storage domain, so the
    // first domain call never races a `experts/unavailable`. Seeding is opt-in since
    // packaged installs ship no default experts; this suite exercises the seeded set.
    await ctx.plugin(ExpertsManager, { seedDefaults, requireInstalledExpert });

    return {
      ctx, root, agentsHome, createCalls,
      get experts() { return ctx.workdshExperts; },
      async cleanup() {
        await ctx.fiber.dispose();
        if (savedAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME; else process.env.DSH_AGENTS_HOME = savedAgentsHome;
        if (savedDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedDshHome;
        if (!existingRoot) await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await ctx.fiber.dispose();
    if (savedAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME; else process.env.DSH_AGENTS_HOME = savedAgentsHome;
    if (savedDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedDshHome;
    if (!existingRoot) await rm(root, { recursive: true, force: true });
    throw error;
  }
}

/** Publish a complete personal expert (a copy of a default) and return its ids. */
async function publishCopyOfDefault(h, a, opPrefix, overrides = {}) {
  const copied = await h.experts.copy(a, 'requirement-analysis-advisor', undefined, { operationId: `${opPrefix}-copy` });
  if (Object.keys(overrides).length > 0) {
    await h.experts.updateDraft(a, copied.expertId, overrides, { operationId: `${opPrefix}-edit` });
  }
  const detail = await h.experts.get(a, copied.expertId);
  const validation = await h.experts.validate(a, copied.expertId, detail.draft.revision);
  assert.equal(validation.publishable, true, `copy should be publishable: ${JSON.stringify(validation.issues)}`);
  const request = await h.experts.requestPublishConfirmation(a, copied.expertId, detail.draft.revision);
  const proof = await h.experts.confirmPublish(a, request.confirmationToken);
  const receipt = await h.experts.publish(a, copied.expertId, detail.draft.revision, validation.dependencyLockDigest, proof, { operationId: `${opPrefix}-publish` });
  return { expertId: copied.expertId, draftRevision: detail.draft.revision, validation, receipt };
}

// ── AT-01: catalog read, search, filters, pagination, visibility ────────────────

test('AT-01 experts list seeds defaults, searches, filters, pages and stays ownership-scoped', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const first = await h.experts.list(a, {});
    assert.equal(first.total, 3, 'the three shipped defaults seed on first read');
    assert.deepEqual(first.items.map((item) => item.origin), ['default', 'default', 'default']);
    assert.ok(first.items.every((item) => item.readiness === 'ready'), 'compiled default presets are healthy');
    assert.ok(first.items.every((item) => item.canUse && item.canManage && !item.canEdit), 'defaults are usable/manageable but not directly editable');
    assert.ok(first.items.every((item) => item.publishedRevisionRef !== undefined), 'defaults are published');

    // '需求' appears in two default descriptions; '用户故事' is a tag unique to the
    // requirement advisor, so the search resolves to exactly one row.
    const hit = await h.experts.list(a, { search: '用户故事' });
    assert.deepEqual(hit.items.map((item) => item.id), ['requirement-analysis-advisor']);
    const miss = await h.experts.list(a, { search: 'zzz-no-such-expert' });
    assert.equal(miss.total, 0);

    const byCategory = await h.experts.list(a, { categoryId: 'quality' });
    assert.deepEqual(byCategory.items.map((item) => item.id), ['document-review-advisor']);
    const byOrigin = await h.experts.list(a, { origin: 'personal' });
    assert.equal(byOrigin.total, 0, 'no personal experts yet');

    const page1 = await h.experts.list(a, { limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextCursor, 'a partial page yields a next cursor');
    const page2 = await h.experts.list(a, { limit: 2, cursor: page1.nextCursor });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.catalogRevision, page1.catalogRevision, 'catalog revision is stable across pages');
    const seen = new Set([...page1.items, ...page2.items].map((item) => item.id));
    assert.equal(seen.size, 3, 'paging visits every row exactly once');
    await assert.rejects(h.experts.list(a, { cursor: 'not-base64-json' }), (err) => err.code === 'experts/cursor-stale');

    // A different principal in the same org cannot see owner-a's personal defaults.
    const memberList = await h.experts.list(actor('member-a'), {});
    assert.equal(memberList.total, 0, 'personal defaults are hidden from other principals');
    // A different organization sees nothing at all (never seeds over owner-a's rows).
    const otherOrg = await h.experts.list(actor('owner-b', 'organization-b'), {});
    assert.equal(otherOrg.total, 0, 'cross-organization catalog is empty');

    const events = h.ctx.workdshAudit.snapshot();
    assert.ok(events.some((event) => event.action === 'experts.list' && event.outcome === 'succeeded'));
  } finally { await h.cleanup(); }
});

// ── AT-22 / AT-15: actor validation and ownership isolation ─────────────────────

test('AT-22/AT-15 a malformed or cross-owner actor is rejected, never treated as an empty list', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    await h.experts.list(a, {}); // seed as owner-a so defaults are owner-a-owned

    const missingResolvedBy = { principalId: 'owner-a', organizationId: 'organization-a', requestId: 'r-bad' };
    await assert.rejects(h.experts.list(missingResolvedBy, {}), (err) => err.code === 'governance/invalid-context');
    await assert.rejects(h.experts.get({ principalId: '', organizationId: 'organization-a', requestId: 'r', resolvedBy: 'x' }, 'requirement-analysis-advisor'), (err) => err.code === 'governance/invalid-context');

    // Same org, different principal → hidden as not-found (no existence leak).
    await assert.rejects(h.experts.get(actor('member-a'), 'requirement-analysis-advisor'), (err) => err.code === 'experts/not-found');
    // Different org → hidden as not-found.
    await assert.rejects(h.experts.get(actor('owner-b', 'organization-b'), 'requirement-analysis-advisor'), (err) => err.code === 'experts/not-found');
  } finally { await h.cleanup(); }
});

// ── AT-04: conversational authoring, validation and field limits ────────────────

test('AT-04 createDraft persists an incomplete draft, validate reports issues, limits are enforced', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    await h.experts.list(a, {}); // seed

    const draft = await h.experts.createDraft(a, { name: 'Incomplete Expert' }, { operationId: 'op-create-1' });
    assert.match(draft.expertId, /^incomplete-expert-[0-9a-f]{12}$/);
    assert.equal(draft.definition.name, 'Incomplete Expert');
    assert.equal(draft.definition.description, '');
    assert.ok(draft.validationIssues.some((issue) => issue.code === 'definition/required'), 'incomplete draft is stored with required-field issues');

    const invalid = await h.experts.validate(a, draft.expertId, draft.revision);
    assert.equal(invalid.publishable, false);
    assert.ok(invalid.issues.length > 0);

    // Fill the required prose → publishable.
    const filled = await h.experts.updateDraft(a, draft.expertId, fullDefinition('Incomplete Expert'), { operationId: 'op-fill-1' });
    const nowValid = await h.experts.validate(a, draft.expertId, filled.revision);
    assert.equal(nowValid.publishable, true, JSON.stringify(nowValid.issues));
    assert.equal(nowValid.dependencyLock.length, 0);

    // Field length limit → definition/limit at the offending path.
    const tooLong = await h.experts.updateDraft(a, draft.expertId, { name: 'x'.repeat(81) }, { operationId: 'op-limit-1' });
    assert.ok(tooLong.validationIssues.some((issue) => issue.code === 'definition/limit' && issue.path === 'name'));

    // Literal template braces are rejected before they can reach persona templating.
    const braces = await h.experts.updateDraft(a, draft.expertId, { role: 'Inject {{model}} literally' }, { operationId: 'op-braces-1' });
    assert.ok(braces.validationIssues.some((issue) => issue.code === 'definition/template-braces' && issue.path === 'role'));

    // A declared-but-unavailable Skill dependency surfaces as an issue, never a silent skip.
    const depDraft = await h.experts.createDraft(a, fullDefinition('Missing Dep Expert', { skillRequirements: [{ name: 'no-such-skill' }] }), { operationId: 'op-create-dep' });
    const depValidation = await h.experts.validate(a, depDraft.expertId, depDraft.revision);
    assert.equal(depValidation.publishable, false);
    assert.ok(depValidation.issues.some((issue) => issue.code === 'experts/dependency-missing' && issue.dependencyRef === 'no-such-skill'));
  } finally { await h.cleanup(); }
});

// ── AT-05: optimistic concurrency on draft update ───────────────────────────────

test('AT-05 concurrent updateDraft with the same expectedRevision: one wins, the other conflicts', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    await h.experts.list(a, {});
    const created = await h.experts.createDraft(a, fullDefinition('CAS Expert'), { operationId: 'op-cas-create' });
    const before = await h.experts.get(a, created.expertId);
    const expectedRevision = before.expert.revision;

    const results = await Promise.allSettled([
      h.experts.updateDraft(a, created.expertId, { description: 'Writer one description.' }, { operationId: 'op-cas-1', expectedRevision }),
      h.experts.updateDraft(a, created.expertId, { description: 'Writer two description.' }, { operationId: 'op-cas-2', expectedRevision }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const conflicted = results.filter((result) => result.status === 'rejected' && result.reason?.code === 'experts/conflict');
    assert.equal(fulfilled.length, 1, 'exactly one concurrent writer commits');
    assert.equal(conflicted.length, 1, 'the loser gets experts/conflict, not a silent overwrite');

    const after = await h.experts.get(a, created.expertId);
    assert.match(after.draft.definition.description, /Writer (one|two) description\./);
    assert.notEqual(after.expert.revision, expectedRevision, 'the winner advanced the revision token');
  } finally { await h.cleanup(); }
});

// ── AT-06: publish authority is a trusted, one-time, content-bound confirmation ──

test('AT-06 publish rejects a forged/unconfirmed proof, a wrong principal, and changed content', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    await h.experts.list(a, {});
    const created = await h.experts.createDraft(a, fullDefinition('Confirmation Expert'), { operationId: 'op-conf-create' });
    const detail = await h.experts.get(a, created.expertId);
    const validation = await h.experts.validate(a, created.expertId, detail.draft.revision);
    const request = await h.experts.requestPublishConfirmation(a, created.expertId, detail.draft.revision);
    assert.equal(request.definitionDigest, validation.definitionDigest);

    // (a) A proof the model/client fabricated → no record → confirmation-required.
    await assert.rejects(
      h.experts.publish(a, created.expertId, detail.draft.revision, validation.dependencyLockDigest, { token: 'forged-token' }, { operationId: 'op-conf-forged' }),
      (err) => err.code === 'experts/confirmation-required',
    );
    // (b) The real challenge token used WITHOUT the trusted UI confirm → not confirmed.
    await assert.rejects(
      h.experts.publish(a, created.expertId, detail.draft.revision, validation.dependencyLockDigest, { token: request.confirmationToken }, { operationId: 'op-conf-unconfirmed' }),
      (err) => err.code === 'experts/confirmation-required',
    );
    // (c) A different principal cannot confirm owner-a's challenge.
    await assert.rejects(h.experts.confirmPublish(actor('member-a'), request.confirmationToken), (err) => err.code === 'experts/forbidden');

    // (d) The trusted confirm exchanges the challenge for a one-time proof; publish succeeds.
    const proof = await h.experts.confirmPublish(a, request.confirmationToken);
    const receipt = await h.experts.publish(a, created.expertId, detail.draft.revision, validation.dependencyLockDigest, proof, { operationId: 'op-conf-publish' });
    assert.equal(receipt.expertId, created.expertId);
    assert.equal(receipt.definitionDigest, validation.definitionDigest);

    // (e) The proof is one-time: reusing it (new operationId) is refused.
    await assert.rejects(
      h.experts.publish(a, created.expertId, detail.draft.revision, validation.dependencyLockDigest, proof, { operationId: 'op-conf-reuse' }),
      (err) => err.code === 'experts/confirmation-required',
    );

    // (f) A confirmed-but-unconsumed proof is bound to the exact digests at confirm time.
    //     Mint a proof for one edit, then move the content again: the now-stale proof must be
    //     refused (its definitionDigest no longer matches), and only a fresh confirm publishes.
    const edited = await h.experts.updateDraft(a, created.expertId, { description: 'Changed after confirmation.' }, { operationId: 'op-conf-edit' });
    const editedRequest = await h.experts.requestPublishConfirmation(a, created.expertId, edited.revision);
    const editedProof = await h.experts.confirmPublish(a, editedRequest.confirmationToken);
    const moved = await h.experts.updateDraft(a, created.expertId, { description: 'Moved again after the proof was minted.' }, { operationId: 'op-conf-move' });
    const movedValidation = await h.experts.validate(a, created.expertId, moved.revision);
    await assert.rejects(
      h.experts.publish(a, created.expertId, moved.revision, movedValidation.dependencyLockDigest, editedProof, { operationId: 'op-conf-stale' }),
      (err) => err.code === 'experts/confirmation-stale',
    );
    // A freshly confirmed proof for the NEW content still publishes.
    const movedRequest = await h.experts.requestPublishConfirmation(a, created.expertId, moved.revision);
    const movedProof = await h.experts.confirmPublish(a, movedRequest.confirmationToken);
    const receipt2 = await h.experts.publish(a, created.expertId, moved.revision, movedValidation.dependencyLockDigest, movedProof, { operationId: 'op-conf-publish-2' });
    assert.equal(receipt2.definitionDigest, movedValidation.definitionDigest);
  } finally { await h.cleanup(); }
});

// ── AT-07 / AT-08: freeze a real Skill dependency, immutable revision, cold restart ─

test('AT-07/AT-08 publish freezes a real Skill dependency into an immutable revision that survives a cold restart', async () => {
  const h = await boot();
  let expertId; let revisionId; let presetRef; let sessionId;
  try {
    const a = actor('owner-a');
    await h.experts.list(a, {});
    const created = await h.experts.createDraft(a, fullDefinition('Dependency Expert', { skillRequirements: [{ name: 'sample-skill' }] }), { operationId: 'op-dep-create' });
    expertId = created.expertId;
    const validation = await h.experts.validate(a, expertId, created.revision);
    assert.equal(validation.publishable, true, JSON.stringify(validation.issues));
    assert.equal(validation.dependencyLock.length, 1);
    assert.equal(validation.dependencyLock[0].skillId, 'sample-skill');
    assert.match(validation.dependencyLock[0].revisionId, /^rev-[0-9a-f]{24}$/);

    const request = await h.experts.requestPublishConfirmation(a, expertId, created.revision);
    assert.equal(request.dependencyLockDigest, validation.dependencyLockDigest);
    const proof = await h.experts.confirmPublish(a, request.confirmationToken);
    const receipt = await h.experts.publish(a, expertId, created.revision, validation.dependencyLockDigest, proof, { operationId: 'op-dep-publish' });
    revisionId = receipt.revision.revisionId;
    presetRef = receipt.presetRevisionRef;
    assert.match(presetRef, /^wd-exp-dependency-expert-[0-9a-f]{12}-[0-9a-f]{12}$/);

    // The frozen dependency is retained as an intact snapshot; the compiled preset is healthy.
    const check = await h.ctx.workdshSkills.checkRevision(validation.dependencyLock[0], a);
    assert.equal(check.status, 'intact');
    const compiled = await h.ctx.agentPresets.resolve(presetRef);
    assert.equal(compiled.broken, undefined, 'the compiled expert preset resolves healthy');

    // Bind a native Session to that exact revision so the restart can verify the binding.
    const plan = await h.experts.prepareExecution(a, expertId, undefined, undefined, undefined, 'Review the dependency expert output.');
    assert.equal(plan.missing.length, 0);
    const creation = await h.experts.createExecution(a, plan.executionPlanId, { operationId: 'op-dep-exec' });
    sessionId = creation.sessionId;

    const detail = await h.experts.get(a, expertId, revisionId);
    assert.equal(detail.readiness, 'ready');
    assert.equal(detail.revision.dependencyLock.length, 1);
    assert.equal(detail.revision.presetRevisionRef, presetRef);
  } finally { /* keep root for the restart below */ }

  // Cold restart: a brand-new Context over the SAME home must recover everything.
  const h2 = await boot(h.root);
  try {
    const a = actor('owner-a');
    const detail = await h2.experts.get(a, expertId, revisionId);
    assert.equal(detail.expert.publishedRevisionRef.revisionId, revisionId, 'published revision survived the restart');
    assert.equal(detail.revision.presetRevisionRef, presetRef);
    assert.equal(detail.readiness, 'ready', 'preset + frozen Skill snapshot are intact after restart');
    const binding = await h2.experts.verifyBinding(a, sessionId);
    assert.equal(binding.sessionId, sessionId);
    assert.equal(binding.expertRevisionRef.revisionId, revisionId);
    // The published revision is immutable: editing the draft does not move the revision digest.
    const beforeEdit = await h2.experts.get(a, expertId, revisionId);
    await h2.experts.updateDraft(a, expertId, { description: 'Post-publish draft edit.' }, { operationId: 'op-dep-postedit' });
    const afterEdit = await h2.experts.get(a, expertId, revisionId);
    assert.equal(afterEdit.revision.definitionDigest, beforeEdit.revision.definitionDigest, 'a published revision is never rewritten in place');
  } finally { await h2.cleanup(); }
});

// ── AT-14: defaults are immutable, copy yields an editable personal expert ──────

test('AT-14 default experts cannot be edited/published; copy creates an editable personal expert; availability persists', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    await h.experts.list(a, {});
    const def = await h.experts.get(a, 'requirement-analysis-advisor');

    await assert.rejects(
      h.experts.updateDraft(a, 'requirement-analysis-advisor', { name: 'Hijacked' }, { operationId: 'op-def-edit' }),
      (err) => err.code === 'experts/forbidden' && err.details?.reason === 'default-immutable',
    );
    await assert.rejects(
      h.experts.requestPublishConfirmation(a, 'requirement-analysis-advisor', def.draft.revision),
      (err) => err.code === 'experts/forbidden' && err.details?.reason === 'default-immutable',
    );

    const copied = await h.experts.copy(a, 'requirement-analysis-advisor', undefined, { operationId: 'op-copy-1' });
    assert.equal(copied.definition.name, '需求分析顾问 副本');
    const copiedDetail = await h.experts.get(a, copied.expertId);
    assert.equal(copiedDetail.expert.origin, 'personal');
    assert.equal(copiedDetail.canEdit, true, 'a copy is editable, unlike its default source');

    // Disable → persisted, and summon is refused while disabled.
    const disabled = await h.experts.setAvailability(a, copied.expertId, 'disabled', { operationId: 'op-disable-1' });
    assert.equal(disabled.availability, 'disabled');
    assert.equal((await h.experts.get(a, copied.expertId)).expert.availability, 'disabled');
    await assert.rejects(
      h.experts.prepareExecution(a, copied.expertId, undefined, undefined, undefined, undefined),
      (err) => err.code === 'experts/disabled',
    );
    const disabledList = await h.experts.list(a, { availability: 'disabled' });
    assert.deepEqual(disabledList.items.map((item) => item.id), [copied.expertId]);

    // Archive → summon and publish are refused.
    await h.experts.setAvailability(a, copied.expertId, 'archived', { operationId: 'op-archive-1' });
    await assert.rejects(
      h.experts.prepareExecution(a, copied.expertId, undefined, undefined, undefined, undefined),
      (err) => err.code === 'experts/archived',
    );
    await assert.rejects(
      h.experts.requestPublishConfirmation(a, copied.expertId, (await h.experts.get(a, copied.expertId)).draft.revision),
      (err) => err.code === 'experts/archived',
    );

    // Re-enable → not archived/disabled anymore, but a fresh copy is still unpublished.
    await h.experts.setAvailability(a, copied.expertId, 'enabled', { operationId: 'op-enable-1' });
    await assert.rejects(
      h.experts.prepareExecution(a, copied.expertId, undefined, undefined, undefined, undefined),
      (err) => err.code === 'experts/not-published',
    );
  } finally { await h.cleanup(); }
});

// ── packaged installs ship no default experts ─────────────────────────────────

test('seedDefaults is off for packaged installs and archives untouched defaults from an earlier release', async () => {
  const empty = await boot(undefined, { seedDefaults: false });
  try {
    const a = actor('owner-a');
    assert.equal((await empty.experts.list(a, {})).total, 0, 'a fresh packaged install starts with an empty catalog');
    assert.equal((await empty.experts.list(a, { availability: 'enabled' })).total, 0);
  } finally { await empty.cleanup(); }

  const seeded = await boot();
  const root = seeded.root;
  assert.equal((await seeded.experts.list(actor('owner-a'), {})).total, 3, 'explicit seeding still ships three templates for probes');

  // Cold restart with seeding switched off: the leftover defaults leave the catalog.
  const off = await boot(root, { seedDefaults: false });
  try {
    const a = actor('owner-a');
    assert.equal((await off.experts.list(a, { availability: 'enabled' })).total, 0, 'untouched defaults are archived on read');
    const detail = await off.experts.get(a, 'requirement-analysis-advisor');
    assert.equal(detail.expert.availability, 'archived');
    assert.equal((await off.experts.list(a, { availability: 'archived' })).total, 3);
  } finally { await off.cleanup(); }
});

// ── AT-16: publish is idempotent per operationId and rejects a reused id ────────

test('AT-16 publish replays the identical receipt for the same operationId and conflicts on a reused id', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    await h.experts.list(a, {});
    const created = await h.experts.createDraft(a, fullDefinition('Idempotent Expert'), { operationId: 'op-idem-create' });
    const detail = await h.experts.get(a, created.expertId);
    const validation = await h.experts.validate(a, created.expertId, detail.draft.revision);
    const request = await h.experts.requestPublishConfirmation(a, created.expertId, detail.draft.revision);
    const proof = await h.experts.confirmPublish(a, request.confirmationToken);

    const first = await h.experts.publish(a, created.expertId, detail.draft.revision, validation.dependencyLockDigest, proof, { operationId: 'op-idem-publish' });
    // Same operationId + same payload → the stored receipt replays (proof not re-consumed).
    const replay = await h.experts.publish(a, created.expertId, detail.draft.revision, validation.dependencyLockDigest, proof, { operationId: 'op-idem-publish' });
    assert.deepEqual(replay, first, 'a committed publish replays byte-for-byte');
    assert.equal(h.createCalls.length, 0, 'publishing never creates a Session');

    // Same operationId but a different payload (draft moved) → idempotency conflict.
    const edited = await h.experts.updateDraft(a, created.expertId, { description: 'A different description.' }, { operationId: 'op-idem-edit' });
    await assert.rejects(
      h.experts.publish(a, created.expertId, edited.revision, validation.dependencyLockDigest, proof, { operationId: 'op-idem-publish' }),
      (err) => err.code === 'experts/idempotency-conflict',
    );
  } finally { await h.cleanup(); }
});

// ── AT-17: summon reserves one native Session per operationId, hands off a draft ─

test('AT-17 createExecution reserves exactly one Session per operationId, stages a one-shot draft handoff and verifies its binding', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    await h.experts.list(a, {});
    const { expertId } = await publishCopyOfDefault(h, a, 'op-exec');

    const plan = await h.experts.prepareExecution(a, expertId, undefined, undefined, undefined, 'Please review this document.');
    assert.equal(plan.missing.length, 0);
    assert.equal(plan.draftText, 'Please review this document.');

    const creation = await h.experts.createExecution(a, plan.executionPlanId, { operationId: 'op-exec-create' });
    assert.match(creation.sessionId, /^session-[0-9a-f]{32}$/, 'a deterministic Session id per operationId');
    assert.equal(h.createCalls.length, 1, 'one native Session created');
    assert.equal(creation.binding.expertRevisionRef.expertId, expertId);

    // Same operationId → committed replay, NO second Session (no orphan on retry).
    const replay = await h.experts.createExecution(a, plan.executionPlanId, { operationId: 'op-exec-create' });
    assert.equal(replay.sessionId, creation.sessionId);
    assert.equal(h.createCalls.length, 1, 'a retry never creates a second Session');
    await assert.rejects(h.experts.createExecution(actor('member-a'), plan.executionPlanId, { operationId: 'op-exec-create' }), error => error.code === 'experts/forbidden');

    // The draft handoff is staged (never auto-sent) and released exactly once.
    const handoff = await h.experts.consumeHandoff(a, creation.handoffId, creation.handoffId);
    assert.equal(handoff.text, 'Please review this document.');
    assert.equal(handoff.sessionId, creation.sessionId);
    await assert.rejects(h.experts.consumeHandoff(a, creation.handoffId, creation.handoffId), (err) => err.code === 'experts/plan-expired');

    // A different operationId reserves a distinct Session.
    const plan2 = await h.experts.prepareExecution(a, expertId, undefined, undefined, undefined, undefined);
    const creation2 = await h.experts.createExecution(a, plan2.executionPlanId, { operationId: 'op-exec-create-2' });
    assert.notEqual(creation2.sessionId, creation.sessionId);
    assert.equal(h.createCalls.length, 2);

    // Binding verification: owner-only, and an unbound/forked Session is rejected.
    const binding = await h.experts.verifyBinding(a, creation.sessionId);
    assert.equal(binding.presetRevisionRef, creation.binding.presetRevisionRef);
    await assert.rejects(h.experts.verifyBinding(actor('member-a'), creation.sessionId), (err) => err.code === 'experts/forbidden');
    await assert.rejects(h.experts.verifyBinding(a, 'session-does-not-exist'), (err) => err.code === 'experts/not-found');
  } finally { await h.cleanup(); }
});

test('G03 native pre-step checks the actual immutable composition and rejects unbound expert forks', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const { expertId } = await publishCopyOfDefault(h, a, 'op-native-guard');
    const plan = await h.experts.prepareExecution(a, expertId);
    const created = await h.experts.createExecution(a, plan.executionPlanId, { operationId: 'op-native-create' });
    h.ctx.workdshIdentity.resolve = async () => a;
    await h.ctx.plugin(SystemPrompt);
    registerExpertExecutionGuard(h.ctx);
    const admit = (sessionId, agentPreset) => h.ctx.waterfall('agent/pre-step', {
      agent: { id: sessionId, ctx: h.ctx, session: { id: sessionId, header: { agentPreset } } },
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }));
    assert.equal((await admit(created.sessionId, created.binding.presetRevisionRef)).kind, 'enter');
    assert.equal((await admit('ordinary-unbound', 'standard')).kind, 'enter');
    await assert.rejects(admit('fork-unbound', created.binding.presetRevisionRef), error => error.code === 'experts/not-found');
    await assert.rejects(admit(created.sessionId, 'standard'), error => error.code === 'experts/conflict');
    const preset = await h.ctx.agentPresets.resolve(created.binding.presetRevisionRef);
    const composition = join(expertPresetDir(preset.id), 'preset.json');
    const original = await readExpertPreset(created.binding.presetRevisionRef);
    await writeFile(composition, original + '\n# external mutation\n');
    await assert.rejects(admit(created.sessionId, created.binding.presetRevisionRef), error => error.code === 'experts/conflict');
  } finally { await h.cleanup(); }
});

test('G01 compiling identical content reuses the preset and refuses existing drift', async () => {
  const h = await boot();
  try {
    const input = { expertId: 'compiler-check', definition: fullDefinition('Compiler check'), snapshotDirs: [], basePresetId: 'standard' };
    const first = await compileExpertPreset(h.ctx, input);
    const second = await compileExpertPreset(h.ctx, input);
    assert.equal(second.created, false);
    assert.equal(second.compositionDigest, first.compositionDigest);
    await writeFile(join(first.presetDir, 'preset.json'), '[]\n');
    await assert.rejects(compileExpertPreset(h.ctx, input), error => error.code === 'experts/preset-drift');
  } finally { await h.cleanup(); }
});

test('published legacy team instructions are migrated to official DSH Team tools at runtime', () => {
  const definition = fullDefinition('Legacy team');
  definition.agentDocument = `---\nname: legacy-team\ndescription: Legacy team\n---\nCall workdsh_expert_team_start, workdsh_expert_team_delegate, workdsh_expert_team_status, workdsh_expert_team_ask and workdsh_expert_team_deliver.`;
  const persona = expertPersonaConfig({
    definition,
    teamMembers: { analyst: { expertId: 'member-1', revision: 'rev-1' } },
  });
  assert.match(persona.prefix, /spawn_teammate/);
  assert.match(persona.prefix, /team_task_create/);
  assert.match(persona.prefix, /team_task_list/);
  assert.match(persona.prefix, /wait_agent/);
  assert.doesNotMatch(persona.prefix, /workdsh_expert_team_/);
});

// Exercise official output validation/rendering, not only the execute JSON.
test('authoring tool content preserves full definitions, CAS tokens and draft links without publish authority', async () => {
  const h = await boot();
  try {
    h.ctx.workdshIdentity.resolve = async () => actor('owner-a');
    h.ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 0; } });
    await h.ctx.plugin(Tools);
    registerExpertManagementTools(h.ctx);
    let call = 0;
    const run = (name, args) => h.ctx.tools.execute({ callId: `author-${++call}`, name, arguments: args, signal: new AbortController().signal });
    const definition = fullDefinition('Authoring fixture');
    const { skillRequirements, futureRequirements, ...prose } = definition;
    const drafted = await run('workdsh_expert_create_draft', { definition: { ...prose, skill_requirements: [], future_requirements: [] } });
    assert.equal(drafted.isError, false, JSON.stringify(drafted));
    const value = drafted.value;
    const catalog = await run('workdsh_expert_list_skills', { expert_id: drafted.value.id });
    assert.equal(catalog.isError, false, JSON.stringify(catalog));
    assert.ok(catalog.value.some(skill => skill.skill_id === 'sample-skill' && skill.name === 'sample-skill' && skill.selectable));
    assert.equal(JSON.stringify(catalog.value).includes(h.root), false, 'Model catalog must not disclose resource paths');
    h.ctx.workdshIdentity.resolve = async () => actor('member-a');
    const denied = await run('workdsh_expert_list_skills', { expert_id: drafted.value.id });
    assert.equal(denied.isError, true, 'Another member cannot query an owner-only authoring catalog');
    h.ctx.workdshIdentity.resolve = async () => actor('owner-a');
    assert.match(JSON.stringify(drafted.content), new RegExp(value.revision));
    assert.match(JSON.stringify(drafted.content), /draft_url/);
    assert.equal(value.definition.role, definition.role);
    const updated = await run('workdsh_expert_update_draft', { expert_id: value.id, expected_revision: value.revision, definition: { description: 'Updated using rendered CAS token.' } });
    assert.equal(updated.isError, false, JSON.stringify(updated));
    const refreshed = await run('workdsh_expert_get', { expert_id: value.id });
    assert.equal(refreshed.isError, false);
    assert.match(JSON.stringify(refreshed.content), /Updated using rendered CAS token/);
    assert.match(JSON.stringify(refreshed.content), /Work step by step/);
    const requested = await run('workdsh_expert_request_publish', { expert_id: value.id, draft_revision: refreshed.value.draft_revision });
    assert.equal(requested.isError, false, JSON.stringify(requested));
    assert.equal(requested.value.status, 'needs-confirmation');
    assert.equal(new URL(requested.value.draft_url, 'http://localhost/').searchParams.get('expert-draft'), value.id);
    assert.equal((await h.experts.get(actor('owner-a'), value.id)).expert.publishedRevisionRef, undefined);
    assert.equal(requested.value.confirmationToken, undefined);
    assert.equal(requested.value.token, undefined);
    assert.equal(h.ctx.tools.get('workdsh_expert_publish'), undefined);
  } finally { await h.cleanup(); }
});

// The official persona, filesystem provider, skill tool and Agent Loop run here.
// Only model I/O is deterministic; this is not a remote-provider acceptance test
// or a claim that the full Host Loader composition ran in this Context.
test('published expert persona and frozen Skill reach the official Agent Loop without leaking into an ordinary task', { timeout: 20000 }, async () => {
  const h = await boot();
  const handles = [];
  try {
    const a = actor('owner-a');
    const { expertId } = await publishCopyOfDefault(h, a, 'op-live', {
      role: 'EXPERT_ROLE_RUNTIME_SENTINEL',
      deliverables: 'EXPERT_DELIVERABLE_RUNTIME_SENTINEL',
      skillRequirements: [{ name: 'sample-skill' }],
    });
    const detail = await h.experts.get(a, expertId);
    const text = await readExpertPreset(detail.revision.presetRevisionRef);
    const packageRequire = createRequire(new URL('package.json', HARNESS_BASE));
    const expertRequire = createRequire(new URL('../../../../packages/plugins/experts/package.json', import.meta.url));
    const { parseDocument } = expertRequire('yaml');
    const rows = JSON.parse(text).plugins;
    const personaConfig = rows.find(row => row.name === '@deepseek-ai/dsh-persona').config;
    const skillConfig = rows.find(row => row.name === '@deepseek-ai/dsh-skill-filesystem').config;
    const persona = await import(pathToFileURL(packageRequire.resolve('@deepseek-ai/dsh-persona')).href);
    for (const plugin of [LocalFileSystem, WorkingDirectory, Sessions, Projections, SystemPrompt, Tools, Llm, Agents, AgentLoop]) await h.ctx.plugin(plugin);
    // Alter the dynamic source after publication: the expert must consume its snapshot.
    await writeFile(join(h.agentsHome, 'skills/sample-skill/SKILL.md'), '---\nname: sample-skill\ndescription: Changed dynamic fixture\n---\nDYNAMIC_SOURCE_AFTER_PUBLISH\n');
    class PublishedSkillAdapter extends SkillRequestAdapter {
      async *stream(options) {
        for await (const event of super.stream(options)) {
          if (event.block?.type === 'tool-call') yield { ...event, block: { ...event.block, arguments: '{"name":"sample-skill"}' } };
          else yield event;
        }
      }
    }
    const expertAdapter = new PublishedSkillAdapter();
    const ordinaryAdapter = new PublishedSkillAdapter();
    for (const [name, adapter, expert] of [['expert', expertAdapter, true], ['ordinary', ordinaryAdapter, false]]) {
      h.ctx.llm.registerAdapter([`live-${name}`], adapter);
      const handle = await h.ctx.agents.create({
        sessionId: `live-${name}`,
        agentOptions: { provider: `live-${name}`, model: 'fixed', cwd: h.root },
        setup: async agentCtx => {
          if (expert) await agentCtx.plugin(persona, personaConfig);
          await agentCtx.plugin(filesystem, expert ? skillConfig : { includeDefaultRoots: false, customSkillDirs: [] });
          await agentCtx.plugin(skillTool);
        },
      });
      handles.push(handle);
      handle.agent.followup(createMessage({ role: 'user', content: [{ type: 'text', text: 'Load the named Skill and finish.' }], source: { kind: 'user' } }));
      await handle.agent.whenIdle();
      assert.equal(adapter.requests.length, 2, JSON.stringify(handle.agent.session.snapshotEvents()));
    }
    const expertRequests = JSON.stringify(expertAdapter.requests);
    assert.match(expertRequests, /EXPERT_ROLE_RUNTIME_SENTINEL/);
    assert.match(expertRequests, /EXPERT_DELIVERABLE_RUNTIME_SENTINEL/);
    assert.match(expertRequests, /Use this fixture when the expert needs it/);
    assert.doesNotMatch(expertRequests, /DYNAMIC_SOURCE_AFTER_PUBLISH/);
    const ordinaryRequests = JSON.stringify(ordinaryAdapter.requests);
    assert.doesNotMatch(ordinaryRequests, /EXPERT_ROLE_RUNTIME_SENTINEL|EXPERT_DELIVERABLE_RUNTIME_SENTINEL|Use this fixture when the expert needs it/);
  } finally {
    for (const handle of handles) await handle.dispose();
    await h.cleanup();
  }
});
test('expert Skill catalog is edit-authorized, path-free and distinguishes unavailable equipped references', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const draft = await h.experts.createDraft(a, fullDefinition('Skill selector fixture', { skillRequirements: [{ name: 'sample-skill', skillId: 'sample-skill' }, { name: 'absent-skill' }] }), { operationId: 'skill-options-create' });
    const options = await h.experts.listSkills(a, draft.expertId, 'available');
    assert.equal(options.find(skill => skill.skillId === 'sample-skill').selectable, true);
    assert.equal(JSON.stringify(options).includes(h.root), false);
    await assert.rejects(h.experts.listSkills(actor('member-a'), draft.expertId, 'available'));
    const equipped = await h.experts.listSkills(a, draft.expertId, 'equipped');
    assert.equal(equipped.length, 2);
    assert.equal(equipped[1].state, 'missing');
    await h.ctx.workdshSkills.setEnabled('sample-skill', false);
    const disabled = (await h.experts.listSkills(a, draft.expertId, 'available')).find(skill => skill.skillId === 'sample-skill');
    assert.equal(disabled.state, 'disabled'); assert.equal(disabled.selectable, false);
    const validation = await h.experts.validate(a, draft.expertId, draft.revision);
    assert.equal(validation.publishable, false);
  } finally { await h.cleanup(); }
});


test('expert publication requires standard and never falls back to another healthy mode', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const copied = await h.experts.copy(a, 'requirement-analysis-advisor', undefined, { operationId: 'mode-copy' });
    const detail = await h.experts.get(a, copied.expertId);
    const validation = await h.experts.validate(a, copied.expertId, detail.draft.revision);
    const request = await h.experts.requestPublishConfirmation(a, copied.expertId, detail.draft.revision);
    const proof = await h.experts.confirmPublish(a, request.confirmationToken);
    const resolve = h.ctx.agentPresets.resolve.bind(h.ctx.agentPresets);
    const calls = [];
    h.ctx.agentPresets.resolve = async id => {
      calls.push(id);
      if (id === 'standard') throw new Error('missing standard fixture');
      return resolve(id ?? 'ptc');
    };
    await assert.rejects(h.experts.publish(a, copied.expertId, detail.draft.revision, validation.dependencyLockDigest, proof, { operationId: 'mode-publish' }), error => error.code === 'experts/preset-broken' && /standard/.test(error.message));
    assert.deepEqual(calls, ['standard']);
    assert.equal((await h.experts.get(a, copied.expertId)).expert.publishedRevisionRef, undefined);
    h.ctx.agentPresets.resolve = resolve;
    assert.equal((await h.ctx.agentPresets.resolve('ptc')).broken, undefined, 'PTC remains available for native tasks');
  } finally { await h.cleanup(); }
});

test('disabled equipped Skill blocks new expert tasks and existing native pre-step without fallback', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const { expertId } = await publishCopyOfDefault(h, a, 'disabled-dependency', { skillRequirements: [{ name: 'sample-skill' }] });
    const initial = await h.experts.prepareExecution(a, expertId);
    const created = await h.experts.createExecution(a, initial.executionPlanId, { operationId: 'before-disable' });
    await h.ctx.workdshSkills.setEnabled('sample-skill', false);
    const unavailable = await h.experts.prepareExecution(a, expertId);
    assert.ok(unavailable.missing.length > 0);
    await assert.rejects(h.experts.createExecution(a, unavailable.executionPlanId, { operationId: 'after-disable' }), error => error.code === 'experts/dependency-missing');
    assert.equal(h.createCalls.length, 1, 'No replacement task is created');
    h.ctx.workdshIdentity.resolve = async () => a;
    await h.ctx.plugin(SystemPrompt);
    registerExpertExecutionGuard(h.ctx);
    await assert.rejects(h.ctx.waterfall('agent/pre-step', {
      agent: { id: created.sessionId, ctx: h.ctx, session: { id: created.sessionId, header: { agentPreset: created.binding.presetRevisionRef } } },
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] })), error => error.code === 'experts/dependency-disabled');
  } finally { await h.cleanup(); }
});


test('complete authored team publishes once with fixed hidden member revisions', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const doc = name => `---\nname: ${name}\ndescription: Team professional\n---\n# ${name}\n\nFull domain reasoning and professional delivery.`;
    const files = {
      '.workdsh-expert/plugin.json': JSON.stringify({ name: 'public-team', expertType: 'team', agentName: 'public-team-team-lead', agents: ['./agents/public-team-team-lead.md', './agents/analyst.md', './agents/reviewer.md'], teamInfo: { leadAgent: 'public-team-team-lead', memberAgents: ['analyst', 'reviewer'] }, workflows: [{ id: 'report', title: 'Report', trigger: 'Produce a report', deliverable: 'Verified report', stages: [{ id: 'draft', worker: 'analyst', reviewer: 'reviewer', dependsOn: [] }] }] }),
      'settings.json': JSON.stringify({ agent: 'public-team-team-lead' }),
      'agents/public-team-team-lead.md': `${doc('public-team-team-lead')}\n\nCall workdsh_expert_team_start before workdsh_expert_team_delegate.`,
      'agents/analyst.md': doc('analyst'), 'agents/reviewer.md': doc('reviewer'),
      'README.md': 'Complete reusable team.'
    };
    const draft = await h.experts.createDraft(a, definitionFromDocuments(files), { operationId: 'authored-team-create' });
    const check = await h.experts.validate(a, draft.expertId, draft.revision);
    assert.equal(check.publishable, true, JSON.stringify(check.issues));
    const request = await h.experts.requestPublishConfirmation(a, draft.expertId, draft.revision);
    const proof = await h.experts.confirmPublish(a, request.confirmationToken);
    await h.experts.publish(a, draft.expertId, draft.revision, check.dependencyLockDigest, proof, { operationId: 'authored-team-publish' });
    const detail = await h.experts.get(a, draft.expertId);
    assert.equal(detail.readiness, 'ready');
    assert.deepEqual(Object.keys(detail.revision.teamMembers).sort(), ['analyst', 'reviewer']);
    for (const [key, ref] of Object.entries(detail.revision.teamMembers)) {
      const member = await h.experts.get(a, ref.expertId);
      assert.equal(member.revision.revisionId, ref.revisionId);
      assert.equal(member.revision.definition.agentDocument, files[`agents/${key}.md`]);
      assert.deepEqual(member.revision.definition.packageDocuments, files);
    }
    const catalog = await h.experts.list(a, {});
    assert.equal(JSON.stringify(catalog).includes('member-'), false);
    const teams = await h.experts.list(a, { expertType: 'team', origin: 'personal', limit: 1 });
    assert.equal(teams.total, 1);
    assert.equal(teams.items[0].id, draft.expertId);
    assert.equal(teams.items[0].expertType, 'team');
    assert.equal((await h.experts.list(a, { expertType: 'agent', origin: 'personal' })).total, 0);
    assert.equal((await h.experts.list(a, { expertType: 'team', search: 'not-found' })).total, 0);

    // Model an immutable revision published by the pre-0.1.6 compiler. Preparing a
    // new execution must advance the published pointer to a derived current revision
    // while leaving the historical row untouched for existing Session bindings.
    const legacyRevisionId = 'rev-legacy-team-runtime';
    await h.experts.revisionsTable().put(keys.revision(draft.expertId, legacyRevisionId), {
      ...detail.revision,
      revisionId: legacyRevisionId,
      presetRevisionRef: 'standard',
      compilerVersion: 'workdsh-expert-compiler/0.2-legacy-team',
      compositionDigest: 'legacy-composition-digest',
    });
    await h.experts.expertsTable().update(keys.expert(draft.expertId), row => ({
      ...row,
      publishedRevisionRef: { expertId: draft.expertId, revisionId: legacyRevisionId },
    }));
    const plan = await h.experts.prepareExecution(a, draft.expertId);
    const migrated = await h.experts.get(a, draft.expertId);
    assert.equal(migrated.revision.compilerVersion, COMPILER_VERSION);
    assert.equal(plan.expertRevisionRef.revisionId, migrated.revision.revisionId);
    assert.notEqual(plan.presetRevisionRef, 'standard');
    assert.equal(h.experts.revisionsTable().get(keys.revision(draft.expertId, legacyRevisionId)).compilerVersion, 'workdsh-expert-compiler/0.2-legacy-team');
    assert.doesNotMatch(await readExpertPreset(plan.presetRevisionRef), /workdsh_expert_team_/);
    const execution = await h.experts.createExecution(a, plan.executionPlanId, { operationId: 'native-asset-binding' });
    assert.equal((await h.experts.resolveNativeRole(a, execution.sessionId, 'analyst')).revision.revisionId, migrated.revision.teamMembers.analyst.revisionId);
    await h.experts.setAvailability(a, draft.expertId, 'disabled', { operationId: 'native-team-disable' });
    await assert.rejects(h.experts.resolveNativeRole(a, execution.sessionId, 'analyst'), error => error.code === 'experts/disabled');
    await h.experts.setAvailability(a, draft.expertId, 'enabled', { operationId: 'native-team-enable' });
    await assert.rejects(h.experts.setAvailability(a, migrated.revision.teamMembers.analyst.expertId, 'disabled', { operationId: 'native-member-disable' }), error => error.code === 'experts/forbidden');
    assert.equal((await h.experts.resolveNativeRole(a, execution.sessionId, 'reviewer')).revision.revisionId, migrated.revision.teamMembers.reviewer.revisionId);
    const cold = await boot(h.root);
    try { assert.deepEqual((await cold.experts.get(a, draft.expertId)).revision.teamMembers, migrated.revision.teamMembers); }
    finally { await cold.cleanup(); }
  } finally { await h.cleanup(); }
});

test('0.1.7 legacy directory expert stays immutable, blocks execution, and can be explicitly republished', async () => {
 const h = await boot();
 try {
  const a = actor('owner-a');
  const {expertId} = await publishCopyOfDefault(h,a,'legacy017');
  const detail = await h.experts.get(a,expertId);
  const legacy = {...detail.revision, revisionId:'legacy-directory-017', presetRevisionRef:'wd-exp-legacy-directory-017', compilerVersion:'workdsh-expert-compiler/0.3', compositionDigest:'legacy-digest'};
  await h.experts.revisionsTable().put(keys.revision(expertId,legacy.revisionId),legacy);
  await h.experts.expertsTable().update(keys.expert(expertId), row=>({...row,publishedRevisionRef:{expertId,revisionId:legacy.revisionId}}));
  const cold = await boot(h.root);
  try {
   assert.notEqual((await cold.experts.get(a,expertId)).readiness,'ready');
   const blocked = await cold.experts.prepareExecution(a,expertId);
   assert.ok(blocked.missing.some(issue=>issue.code==='experts/preset-broken'));
   await assert.rejects(cold.experts.createExecution(a,blocked.executionPlanId,{operationId:'legacy017-blocked'}));
   assert.deepEqual(cold.experts.revisionsTable().get(keys.revision(expertId,legacy.revisionId)),legacy);
   const draft = await cold.experts.updateDraft(a,expertId,{description:'Explicit 0.1.7 publication'},{operationId:'legacy017-edit'});
   const validation = await cold.experts.validate(a,expertId,draft.revision);
   assert.equal(validation.publishable,true);
   const request = await cold.experts.requestPublishConfirmation(a,expertId,draft.revision);
   const proof = await cold.experts.confirmPublish(a,request.confirmationToken);
   await cold.experts.publish(a,expertId,draft.revision,validation.dependencyLockDigest,proof,{operationId:'legacy017-republish'});
   const plan = await cold.experts.prepareExecution(a,expertId);
   assert.notEqual(plan.expertRevisionRef.revisionId,legacy.revisionId);
   const created = await cold.experts.createExecution(a,plan.executionPlanId,{operationId:'legacy017-create'});
   assert.ok(created.sessionId);
   assert.deepEqual(cold.experts.revisionsTable().get(keys.revision(expertId,legacy.revisionId)),legacy);
  } finally {await cold.cleanup();}
 } finally {await h.cleanup();}
});

/** The process owns one fixed member; live admission must survive its async verification. */
function fixedMemberAdmission(ctx) {
  let active = true; let epoch = 0; let principalId = 'owner-a'; let organizationId = 'organization-a';
  let verificationHook; const evidence = [];
  const revoke = () => { active = false; epoch++; };
  ctx.workdshIdentity.resolve = async (request, signal) => {
    signal?.throwIfAborted(); evidence.push(request);
    const admittedEpoch = epoch; const verified = { principalId, organizationId };
    // The real process provider awaits the backend account response before admission.
    await Promise.resolve(); verificationHook?.(); signal?.throwIfAborted();
    if (!active || admittedEpoch !== epoch) throw Error('Expired fixed-member admission');
    if (verified.principalId !== 'owner-a' || verified.organizationId !== 'organization-a') throw Error('Fixed member identity mismatch');
    return { ...actor(verified.principalId, verified.organizationId), ...(request?.sessionId ? { sessionId: request.sessionId } : {}) };
  };
  return {
    evidence, revoke,
    restore() { active = true; epoch++; principalId = 'owner-a'; organizationId = 'organization-a'; verificationHook = undefined; },
    foreign() { principalId = 'owner-b'; organizationId = 'organization-b'; epoch++; },
    revokeDuringVerification() { verificationHook = revoke; },
  };
}

test('expert tools use live fixed-member admission and deny expiry or foreign identities', async () => {
  const h = await boot();
  try {
    h.ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 0; } });
    await h.ctx.plugin(Tools);
    const member = fixedMemberAdmission(h.ctx);
    const agent = { id: 'member-session' };
    registerExpertManagementTools(h.ctx);
    const run = () => h.ctx.tools.execute({ callId: 'member-list', name: 'workdsh_expert_list', arguments: {}, agent, signal: new AbortController().signal });
    assert.equal((await run()).isError, false);
    member.revoke(); const expired = await run(); assert.equal(expired.isError, true); assert.match(expired.error.message, /Expired/);
    member.restore(); member.foreign(); const foreign = await run(); assert.equal(foreign.isError, true); assert.match(foreign.error.message, /identity mismatch/);
    member.restore(); member.revokeDuringVerification(); const revoked = await run(); assert.equal(revoked.isError, true); assert.match(revoked.error.message, /Expired/);
    member.restore(); assert.equal((await run()).isError, false);
    assert.ok(member.evidence.every(request => request.sessionId === agent.id), 'only the official calling Agent supplies the Session evidence');
  } finally { await h.cleanup(); }
});

test('expert page routes reject expired, foreign or revoked live admission without returning data', async () => {
  const h = await boot();
  try {
    const routes = new Map(); const member = fixedMemberAdmission(h.ctx);
    h.ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return async () => routes.delete(route.path); } } });
    registerExpertsConnection(h.ctx);
    const call = async () => {
      const response = await routes.get('/api/workdsh-experts').fetch(new Request('http://localhost/api/workdsh-experts', {
        method: 'POST', body: JSON.stringify({ endpoint: 'list', payload: {}, principalId: 'forged' }),
      }));
      return response.json();
    };
    const allowed = await call(); assert.equal(allowed.ok, true); assert.ok(Array.isArray(allowed.value.items));
    const assertDenied = result => { assert.equal(result.ok, false); assert.equal(result.error.code, 'experts/internal'); assert.equal('value' in result, false); };
    member.revoke(); assertDenied(await call());
    member.restore(); member.foreign(); assertDenied(await call());
    member.restore(); member.revokeDuringVerification(); assertDenied(await call());
    member.restore(); assert.equal((await call()).ok, true);
    assert.ok(member.evidence.every(request => request === undefined), 'browser actor fields do not become trusted identity evidence');
    await h.cleanup(); assert.equal(routes.size, 0);
  } finally { await h.cleanup(); }
});

test('expert execution guard admits ordinary unbound tasks only through live fixed-member identity', async () => {
  const h = await boot();
  try {
    await h.ctx.plugin(SystemPrompt);
    const member = fixedMemberAdmission(h.ctx);
    const agent = { id: 'member-ordinary', ctx: h.ctx, session: { header: {} } };
    registerExpertExecutionGuard(h.ctx, { agentsHome: h.agentsHome });
    const run = () => h.ctx.waterfall('agent/pre-step', { agent, signal: new AbortController().signal }, async () => ({ kind: 'enter' }));
    assert.equal((await run()).kind, 'enter');
    member.revoke(); await assert.rejects(run(), /Expired/);
    member.restore(); member.foreign(); await assert.rejects(run(), /identity mismatch/);
    member.restore(); member.revokeDuringVerification(); await assert.rejects(run(), /Expired/);
    member.restore(); assert.equal((await run()).kind, 'enter');
    assert.ok(member.evidence.every(request => request.sessionId === agent.id));
  } finally { await h.cleanup(); }
});


test('expert presets default to the persisted DSH_HOME when DSH_AGENTS_HOME is absent', async () => {
  const h = await boot(undefined, { profileAgents: true });
  try {
    const { receipt } = await publishCopyOfDefault(h, actor('owner-a'), 'persistent-home');
    const presetPath = expertPresetDir(receipt.presetRevisionRef, h.agentsHome);
    assert.equal((await stat(presetPath)).isDirectory(), true);
    assert.ok(presetPath.startsWith(join(h.root, 'dsh', 'agents')));
  } finally { await h.cleanup(); }
});

test('publish and the execution guard read $DSH_HOME/agents when DSH_AGENTS_HOME is unset', async () => {
  const h = await boot(undefined, { profileAgents: true });
  try {
    const a = actor('owner-a');
    const doc = name => `---\nname: ${name}\ndescription: Team professional\n---\n# ${name}\n\nFull domain reasoning and professional delivery.`;
    const files = {
      '.workdsh-expert/plugin.json': JSON.stringify({ name: 'home-team', expertType: 'team', agentName: 'home-team-team-lead', agents: ['./agents/home-team-team-lead.md', './agents/analyst.md', './agents/reviewer.md'], teamInfo: { leadAgent: 'home-team-team-lead', memberAgents: ['analyst', 'reviewer'] }, workflows: [{ id: 'report', title: 'Report', trigger: 'Produce a report', deliverable: 'Verified report', stages: [{ id: 'draft', worker: 'analyst', reviewer: 'reviewer', dependsOn: [] }] }] }),
      'settings.json': JSON.stringify({ agent: 'home-team-team-lead' }),
      'agents/home-team-team-lead.md': doc('home-team-team-lead'),
      'agents/analyst.md': doc('analyst'),
      'agents/reviewer.md': doc('reviewer'),
      'README.md': 'Agents home regression.',
    };
    const draft = await h.experts.createDraft(a, definitionFromDocuments(files), { operationId: 'home-team-create' });
    const check = await h.experts.validate(a, draft.expertId, draft.revision);
    assert.equal(check.publishable, true, JSON.stringify(check.issues));
    const request = await h.experts.requestPublishConfirmation(a, draft.expertId, draft.revision);
    const proof = await h.experts.confirmPublish(a, request.confirmationToken);
    const receipt = await h.experts.publish(a, draft.expertId, draft.revision, check.dependencyLockDigest, proof, { operationId: 'home-team-publish' });
    const publishedDir = expertPresetDir(receipt.presetRevisionRef, h.agentsHome);
    assert.equal(expertPresetDir(receipt.presetRevisionRef), publishedDir);
    assert.equal(await readExpertPreset(receipt.presetRevisionRef), await readFile(join(publishedDir, 'preset.json'), 'utf8'));
    const plan = await h.experts.prepareExecution(a, draft.expertId);
    const created = await h.experts.createExecution(a, plan.executionPlanId, { operationId: 'home-team-exec' });
    h.ctx.workdshIdentity.resolve = async () => a;
    await h.ctx.plugin(SystemPrompt);
    const agentScope = createScope(h.ctx, created.sessionId);
    registerExpertExecutionGuard(h.ctx);
    const entered = await h.ctx.waterfall('agent/pre-step', {
      agent: { id: created.sessionId, ctx: agentScope.ctx, session: { id: created.sessionId, header: { agentPreset: created.binding.presetRevisionRef, cwd: h.root } } },
      messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }));
    assert.equal(entered.kind, 'enter');
    await agentScope.dispose();
  } finally { await h.cleanup(); }
});

test('one missing expert preset does not disable the manager after a cold restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-broken-expert-'));
  let h = await boot(root);
  try {
    const a = actor('owner-a');
    const broken = await publishCopyOfDefault(h, a, 'missing-preset');
    const healthy = await publishCopyOfDefault(h, a, 'healthy-preset');
    await rm(expertPresetDir(broken.receipt.presetRevisionRef, h.agentsHome), { recursive: true, force: true });
    await h.cleanup();
    h = await boot(root);
    assert.equal((await h.experts.get(a, broken.expertId)).readiness, 'broken');
    assert.equal((await h.experts.get(a, healthy.expertId)).readiness, 'ready');
    const list = await h.experts.list(a, {});
    assert.equal(list.items.find(row => row.id === broken.expertId).readiness, 'broken');
  } finally { await h.cleanup(); await rm(root, { recursive: true, force: true }); }
});


test('required ready connector is selected in the native expert session and becomes unavailable when disabled', async () => {
  let enabled = true;
  const selections = new Map();
  const connectors = {
    async list() { return [{ id: 'test-connector', enabled, state: enabled ? 'ready' : 'disabled' }]; },
    async selection(id) { return selections.get(id) ?? ['already-selected']; },
    async setSelection(id, ids) { selections.set(id, ids); return ids; },
  };
  const h = await boot(undefined, { connectors });
  try {
    const a = actor('owner-a');
    const { expertId } = await publishCopyOfDefault(h, a, 'connector-ready', {
      futureRequirements: [{ kind: 'connector', key: 'test-connector', required: true, description: 'Test connector' }],
    });
    assert.equal((await h.experts.get(a, expertId)).readiness, 'ready');
    const plan = await h.experts.prepareExecution(a, expertId);
    assert.deepEqual(plan.missing, []);
    const execution = await h.experts.createExecution(a, plan.executionPlanId, { operationId: 'connector-execution' });
    assert.deepEqual(selections.get(execution.sessionId), ['already-selected', 'test-connector']);
    const stale = await h.experts.prepareExecution(a, expertId);
    enabled = false;
    await assert.rejects(h.experts.createExecution(a, stale.executionPlanId, { operationId: 'connector-disabled' }), error => error.code === 'experts/dependency-missing');
    const blocked = await h.experts.prepareExecution(a, expertId);
    assert.equal(blocked.missing[0].code, 'experts/connector-unavailable');
    assert.match(blocked.missing[0].message, /test-connector/);
  } finally { await h.cleanup(); }
});

test('optional absent connector does not block expert execution or grant selection', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const { expertId } = await publishCopyOfDefault(h, a, 'connector-optional', {
      futureRequirements: [{ kind: 'connector', key: 'not-installed', required: false, description: 'Optional' }],
    });
    const plan = await h.experts.prepareExecution(a, expertId);
    assert.deepEqual(plan.missing, []);
    await h.experts.createExecution(a, plan.executionPlanId, { operationId: 'optional-execution' });
  } finally { await h.cleanup(); }
});


test('missing required connector reports its ID before creating a native session', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const { expertId } = await publishCopyOfDefault(h, a, 'connector-missing', {
      futureRequirements: [{ kind: 'connector', key: 'missing-connector', required: true, description: 'Required' }],
    });
    const plan = await h.experts.prepareExecution(a, expertId);
    assert.equal(plan.missing[0].code, 'experts/connector-unavailable');
    assert.match(plan.missing[0].message, /missing-connector/);
    await assert.rejects(h.experts.createExecution(a, plan.executionPlanId, { operationId: 'missing-execution' }), error => error.code === 'experts/dependency-missing');
    assert.equal(h.createCalls.length, 0);
  } finally { await h.cleanup(); }
});

// ── backend catalog: install / update / hard-delete uninstall ─────────────────

/** Minimal `workdshBackend` stand-in: one catalog page per type, no envelope. */
function fakeBackend(rows) {
  return {
    async available() { return true; },
    async get(path, query) {
      const page = path.includes('expertgroup') ? (rows.team ?? []) : (rows.agent ?? []);
      const records = query?.id === undefined ? page : page.filter(row => row.id === query.id);
      return { current: 1, size: records.length, total: records.length, pages: 1, records };
    },
  };
}

/** Backend row shape documented in `AiClientController` (only the fields we map). */
function remoteRow({ id, name, version = 'v1.0.0', archive, digest, withPackage = true }) {
  return {
    id, name, version, description: `后台专家 ${name}`, tags: '远程,测试',
    capability: '后台下发的专家能力', useCase: '联调验证',
    status: '3', delFlag: 0, updateTime: '2026-10-22 10:00:00',
    fjxxList: withPackage && archive
      ? [{ fileName: `${id}.expert.zip`, filePath: `https://packages.test/${id}.zip`, fileSize: String(archive.byteLength), ...(digest ? { sha256: digest } : {}) }]
      : null,
  };
}

test('backend catalog installs to local and publishes; uninstall hard-deletes records and presets', async () => {
  const h = await boot();
  const originalFetch = globalThis.fetch;
  try {
    const a = actor('owner-a');
    const definition = fullDefinition('后台下发专家', { tags: ['remote'] });
    const { archive } = buildExport(definition);
    const bytes = Buffer.from(archive);
    const digest = createHash('sha256').update(bytes).digest('hex');
    globalThis.fetch = async (input, init) => {
      if (String(input) === 'https://packages.test/remote-1.zip') {
        return new Response(bytes, { status: 200, headers: { 'content-type': 'application/zip' } });
      }
      return originalFetch(input, init);
    };
    h.ctx.provide('workdshBackend', fakeBackend({ agent: [remoteRow({ id: 'remote-1', name: '后台下发专家', archive: bytes, digest })] }));

    const catalog = await h.experts.remoteList(a, { expertType: 'agent' });
    assert.equal(catalog.available, true);
    assert.equal(catalog.total, 1);
    assert.equal(catalog.items[0].remoteId, 'remote-1');
    assert.equal(catalog.items[0].installed, undefined, 'a catalog row is not installed until the user installs it');

    const receipt = await h.experts.installRemote(a, { expertType: 'agent', remoteId: 'remote-1' }, { operationId: 'install-1' });
    assert.equal(receipt.published, true, 'a package without Skill dependencies publishes immediately');
    assert.equal(receipt.installation.status, 'ready');
    assert.equal(receipt.installation.packageDigest, digest);

    const detail = await h.experts.get(a, receipt.expertId);
    assert.equal(detail.readiness, 'ready');
    const presetDir = expertPresetDir(detail.revision.presetRevisionRef, h.agentsHome);
    await stat(join(presetDir, 'preset.json'));
    const plan = await h.experts.prepareExecution(a, receipt.expertId);
    assert.deepEqual(plan.missing, [], 'an installed expert is summonable');

    const installed = await h.experts.remoteList(a, { expertType: 'agent' });
    assert.equal(installed.items[0].installed.expertId, receipt.expertId);
    assert.equal(installed.items[0].installed.updateAvailable, false);

    const removed = await h.experts.uninstallRemote(a, 'agent-remote-1', { operationId: 'uninstall-1' });
    assert.deepEqual(removed.deletedExpertIds, [receipt.expertId]);
    await assert.rejects(h.experts.get(a, receipt.expertId), error => error.code === 'experts/not-found');
    await assert.rejects(stat(join(presetDir, 'preset.json')), 'the preset directory is removed from disk');
    assert.deepEqual(await h.experts.listInstallations(a), []);
    assert.equal((await h.experts.remoteList(a, { expertType: 'agent' })).items[0].installed, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await h.cleanup();
  }
});

test('backend install refuses a missing package and a digest mismatch', async () => {
  const h = await boot();
  const originalFetch = globalThis.fetch;
  try {
    const a = actor('owner-a');
    const { archive } = buildExport(fullDefinition('后台专家二'));
    const bytes = Buffer.from(archive);
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith('https://packages.test/')) return new Response(bytes, { status: 200 });
      return originalFetch(input, init);
    };
    h.ctx.provide('workdshBackend', fakeBackend({
      agent: [
        remoteRow({ id: 'remote-2', name: '后台专家二', archive: bytes, withPackage: false }),
        remoteRow({ id: 'remote-3', name: '后台专家三', archive: bytes, digest: 'f'.repeat(64) }),
      ],
    }));

    await assert.rejects(
      h.experts.installRemote(a, { expertType: 'agent', remoteId: 'remote-2' }, { operationId: 'install-2' }),
      error => error.code === 'experts/install-package-missing',
      'a row without an attachment cannot be installed',
    );
    await assert.rejects(
      h.experts.installRemote(a, { expertType: 'agent', remoteId: 'remote-3' }, { operationId: 'install-3' }),
      error => error.code === 'experts/install-digest-mismatch',
      'a package whose sha256 differs is rejected before import',
    );
    assert.deepEqual(await h.experts.listInstallations(a), []);
  } finally {
    globalThis.fetch = originalFetch;
    await h.cleanup();
  }
});

test('product mode blocks self-made experts until they are installed from the catalog', async () => {
  const h = await boot(undefined, { requireInstalledExpert: true });
  const originalFetch = globalThis.fetch;
  try {
    const a = actor('owner-a');
    // Published locally, but never listed/approved/installed: not executable.
    const mine = await publishCopyOfDefault(h, a, 'gate-mine');
    const mineDetail = await h.experts.get(a, mine.expertId);
    assert.equal(mineDetail.installedFromCatalog, false);
    assert.equal(mineDetail.executionBlocked, 'approval-required');
    await assert.rejects(
      h.experts.prepareExecution(a, mine.expertId),
      error => error.code === 'experts/approval-required',
      'a self-made expert must not be summonable',
    );
    const listed = await h.experts.list(a, { origin: 'personal' });
    assert.equal(listed.items.find(row => row.id === mine.expertId).executionBlocked, 'approval-required');

    // Installed from the backend catalog: executable with no further review step.
    const { archive } = buildExport(fullDefinition('审核通过专家'));
    const bytes = Buffer.from(archive);
    globalThis.fetch = async (input, init) => String(input).startsWith('https://packages.test/')
      ? new Response(bytes, { status: 200 })
      : originalFetch(input, init);
    h.ctx.provide('workdshBackend', fakeBackend({ agent: [remoteRow({ id: 'approved-1', name: '审核通过专家', archive: bytes })] }));
    const receipt = await h.experts.installRemote(a, { expertType: 'agent', remoteId: 'approved-1' }, { operationId: 'gate-install' });
    const detail = await h.experts.get(a, receipt.expertId);
    assert.equal(detail.installedFromCatalog, true);
    assert.equal(detail.executionBlocked, undefined);
    const plan = await h.experts.prepareExecution(a, receipt.expertId);
    assert.deepEqual(plan.missing, []);
  } finally {
    globalThis.fetch = originalFetch;
    await h.cleanup();
  }
});

test('listing request uploads the current draft and hard delete removes every local file', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const created = await h.experts.createDraft(a, fullDefinition('待上架专家', { role: '角色能力说明' }), { operationId: 'listing-draft' });
    const uploads = [];
    const posts = [];
    h.ctx.provide('workdshBackend', {
      async available() { return true; },
      async get(path) {
        if (path.endsWith('/queryAiNodeList')) return [{ value: 'node-self', label: '本级节点', nodeType: 'self' }];
        if (path.endsWith('/getDictItems/yn')) return [{ value: '1', text: '公开' }, { value: '0', text: '非公开' }];
        if (path.endsWith('/getDictItems/ai_expert_domain')) return [{ value: '反诈劝阻', text: '反诈劝阻' }];
        throw new Error(`unexpected GET ${path}`);
      },
      async post(path, body) { posts.push({ path, body }); return '专家上架申请成功！'; },
      async postForm(path, form) { uploads.push({ path, form }); return { filePath: 'https://files.test/expert.zip' }; },
    });

    const options = await h.experts.listingOptions(a);
    assert.equal(options.available, true);
    assert.deepEqual(options.nodes.map(node => node.nodeType), ['self']);
    assert.deepEqual(options.domains.map(option => option.value), ['反诈劝阻']);

    const message = await h.experts.submitListing(a, {
      expertId: created.expertId, name: '待上架专家', sourceNode: 'node-self',
      capability: '能力说明', tags: ['反诈'], owner: '张三', department: '科信支队',
      domain: '反诈劝阻', isPublic: '1', listed: true,
    });
    assert.equal(message, '专家上架申请成功！');
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].path, '/desktop-client/upload');
    assert.equal(uploads[0].form.get('biz'), 'desktop-client/expert');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, '/desktop-client/expert/listingRequest');
    assert.equal(posts[0].body.name, '待上架专家');
    assert.equal(posts[0].body.domain, '反诈劝阻');
    assert.equal(posts[0].body.capability, '能力说明');
    assert.match(posts[0].body.reason, /上架申请/u);
    assert.equal(posts[0].body.attachmentInfo.filePath, 'https://files.test/expert.zip');
    assert.ok(Number(posts[0].body.attachmentInfo.fileSize) > 0, 'attachment size is the exported archive length');

    const removed = await h.experts.deleteExpert(a, created.expertId, { operationId: 'delete-local' });
    assert.deepEqual(removed.deletedExpertIds, [created.expertId]);
    await assert.rejects(h.experts.get(a, created.expertId), error => error.code === 'experts/not-found');
    assert.equal((await h.experts.list(a, { origin: 'personal' })).items.some(row => row.id === created.expertId), false);
  } finally { await h.cleanup(); }
});

test('my listing ledger maps expert and team applications with local status labels', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    h.ctx.provide('workdshBackend', {
      async available() { return true; },
      async get(path) {
        if (path.includes('queryMyListingExpertList')) {
          return {
            current: 1, size: 2, total: 2, pages: 1,
            records: [
              { id: 'm1', name: '待审批专家', status: '2', version: 'v1.0.0', tags: '反诈', domain: '反诈劝阻', listingReason: '申请上架', updateTime: '2026-10-22 17:03:14', delFlag: 0, fjxxList: [{ fileName: 'e.zip', filePath: 'https://files.test/e.zip', fileSize: '20480' }] },
              { id: 'm2', name: '被驳回专家', status: '4', delFlag: 0, offlineReason: '材料不全' },
            ],
          };
        }
        if (path.includes('queryMyListingExpertGroupList')) {
          return { current: 1, size: 1, total: 1, pages: 1, records: [{ id: 'g1', name: '申请中的团', status: '3', memberIds: 'a,b', delFlag: 0 }] };
        }
        throw new Error(`unexpected GET ${path}`);
      },
      async post() { throw new Error('unused'); },
      async postForm() { throw new Error('unused'); },
    });

    const agent = await h.experts.myListings(a, { expertType: 'agent' });
    assert.equal(agent.available, true);
    assert.equal(agent.total, 2);
    assert.equal(agent.items[0].statusLabel, '待审批');
    assert.equal(agent.items[0].package.fileName, 'e.zip');
    assert.equal(agent.items[1].statusLabel, '已驳回');
    assert.equal(agent.items[1].offlineReason, '材料不全');

    const team = await h.experts.myListings(a, { expertType: 'team' });
    assert.equal(team.items[0].statusLabel, '已上架');
    assert.deepEqual(team.items[0].memberIds, ['a', 'b']);
  } finally { await h.cleanup(); }
});

test('withdraw listing posts to the matching expert or team endpoint', async () => {
  const h = await boot();
  try {
    const a = actor('owner-a');
    const calls = [];
    h.ctx.provide('workdshBackend', {
      async available() { return true; },
      async get() { throw new Error('unused'); },
      async post(path, body) { calls.push({ path, body }); return { code: 200, message: '撤回申请成功' }; },
      async postForm() { throw new Error('unused'); },
    });

    assert.equal(await h.experts.withdrawListing(a, { expertType: 'agent', remoteId: 'e1' }), '撤回申请成功');
    assert.equal(await h.experts.withdrawListing(a, { expertType: 'team', remoteId: 'g1', reason: '不需要了' }), '撤回申请成功');
    assert.deepEqual(calls, [
      { path: '/desktop-client/expert/withdrawListingRequest', body: { id: 'e1' } },
      { path: '/desktop-client/expertgroup/withdrawListingRequest', body: { id: 'g1', reason: '不需要了' } },
    ]);
  } finally { await h.cleanup(); }
});
