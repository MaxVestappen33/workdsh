import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import { ProjectManager } from '../dist/services/project-manager.js';
import { projectDomainSpec, projectStateKey } from '../dist/storage/domain.js';
import { registerProjectConnection } from '../dist/remote/connection-api.js';
import { provideSessionAuthority } from './fixtures/session-authority.mjs';
import { SessionAccessBridge } from '../../access/dist/index.js';

const actor = { principalId: 'alice', organizationId: 'org', requestId: 'association', resolvedBy: 'test' };
async function withProjects(work, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-project-session-'));
  const ctx = new Context();
  try {
    await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root }); await ctx.plugin(StorageDomain, { backend: 'json' });
    const authority = provideSessionAuthority(ctx, actor, options);
    if (options.seed) await options.seed(ctx);
    await ctx.plugin(ProjectManager);
    await work(ctx.workdshProjects, authority, ctx);
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); }
}

test('foreign owners and missing native sessions cannot acquire a project binding', () => withProjects(async (manager, authority) => {
  const project = await manager.create(actor, { name: 'Ownership' });
  authority.owners.set('foreign', { sessionId: 'foreign', organizationId: 'org', ownerPrincipalId: 'bob', revision: 'foreign-1' });
  await assert.rejects(manager.linkTask(actor, project.project.id, 'foreign', 'wrong owner'), /projects\/session-access-denied/);
  await assert.rejects(manager.linkTask(actor, project.project.id, 'missing', 'missing'), /projects\/session-unavailable/);
  assert.equal((await manager.get(actor, project.project.id)).tasks.length, 0);
  assert.ok(!authority.inspections.includes('foreign'));
}));

test('same-binding retries are idempotent; project/config changes require another session', () => withProjects(async manager => {
  const first = await manager.create(actor, { name: 'First' });
  const second = await manager.create(actor, { name: 'Second' });
  const task = await manager.linkTask(actor, first.project.id, 'session-1', 'analysis');
  assert.equal((await manager.linkTask(actor, first.project.id, 'session-1', 'analysis')).id, task.id);
  await assert.rejects(manager.linkTask(actor, second.project.id, 'session-1', 'analysis'), /projects\/session-binding-conflict/);
  await manager.updateConfig(actor, first.project.id, { instruction: 'new instruction', capabilities: [] }, first.config.id);
  await assert.rejects(manager.linkTask(actor, first.project.id, 'session-1', 'analysis'), /projects\/session-binding-conflict/);
  assert.equal((await manager.taskContext(actor, 'session-1')).config.id, first.config.id);
  assert.equal((await manager.get(actor, first.project.id)).tasks.length, 1);
  assert.equal((await manager.get(actor, first.project.id)).activity.filter(row => row.kind === 'task').length, 1);
}));

test('legacy conflicting associations are visible errors, not first-match context selection', () => withProjects(async manager => {
  await assert.rejects(manager.taskContext(actor, 'session-1'), /projects\/session-link-conflict/);
  assert.equal((await manager.get(actor, 'first')).tasks.length, 1);
  assert.equal((await manager.get(actor, 'second')).tasks.length, 1);
}, { seed: async ctx => {
  const domain = await ctx.storageDomain.open(projectDomainSpec);
  try {
    const owner = { organizationId: actor.organizationId, ownerPrincipalId: actor.principalId, scope: 'personal' };
    const projects = {}, configs = {}, tasks = {};
    for (const id of ['first', 'second']) {
      projects[id] = { id, name: id, owner, status: 'active', configRevisionId: `${id}-config` };
      configs[`${id}-config`] = { id: `${id}-config`, projectId: id, number: 1, instruction: '', capabilities: [] };
      tasks[id] = { id, projectId: id, sessionId: 'session-1', title: 'analysis', configRevisionId: `${id}-config`, capabilities: [], references: [] };
    }
    await domain.table('states').put(projectStateKey(actor.organizationId, actor.principalId), { schemaVersion: 1, projects, configs, tasks, workItems: {}, assets: {}, activity: {} });
  } finally { await domain.close(); }
} }));

test('only an existing personal native session may receive an initial owner binding', () => withProjects(async (manager, authority) => {
  const project = await manager.create(actor, { name: 'Personal' });
  authority.sessions.add('native-personal');
  await manager.linkTask(actor, project.project.id, 'native-personal', 'new native task');
  assert.equal(authority.owners.get('native-personal').ownerPrincipalId, actor.principalId);
}));

test('an unbound enterprise session cannot be claimed through a project request', () => withProjects(async (manager, authority) => {
  const project = await manager.create(actor, { name: 'Enterprise' });
  authority.sessions.add('native-enterprise');
  await assert.rejects(manager.linkTask(actor, project.project.id, 'native-enterprise', 'wrong claim'), /projects\/session-access-denied/);
  assert.equal(authority.owners.has('native-enterprise'), false);
}, { enterprise: true }));

test('enterprise project linking uses the existing fixed-member SessionAccessBridge', () => withProjects(async (manager, authority, ctx) => {
  ctx.provide('workdshAudit', { append: async () => {}, flush: async () => {} });
  await ctx.plugin(SessionAccessBridge, { autoBindFixedMemberSessions: true });
  const project = await manager.create(actor, { name: 'Protected enterprise' });
  authority.sessions.add('native-enterprise');
  const task = await manager.linkTask(actor, project.project.id, 'native-enterprise', 'member task');
  assert.equal(authority.owners.get('native-enterprise').ownerPrincipalId, actor.principalId);
  assert.equal((await manager.taskContext(actor, task.sessionId)).project.id, project.project.id);
}, { enterprise: true }));

test('a changed owner and a cancelled request cannot reuse a project context', () => withProjects(async (manager, authority) => {
  const project = await manager.create(actor, { name: 'Current owner' });
  await manager.linkTask(actor, project.project.id, 'session-1', 'analysis');
  authority.owners.set('session-1', { sessionId: 'session-1', organizationId: 'other-org', ownerPrincipalId: actor.principalId, revision: 'changed' });
  await assert.rejects(manager.taskContext(actor, 'session-1'), /projects\/session-access-denied/);
  const abort = new AbortController(); abort.abort(new Error('test/cancelled'));
  await assert.rejects(manager.linkTask(actor, project.project.id, 'session-2', 'cancelled', undefined, [], abort.signal), /test\/cancelled/);
  assert.equal((await manager.get(actor, project.project.id)).tasks.length, 1);
}));

test('project storage-key collisions fail closed without overwriting the original owner', () => withProjects(async manager => {
  const original = { ...actor, principalId: 'alice.a' };
  const alias = { ...actor, principalId: 'alice-a' };
  const project = await manager.create(original, { name: 'Private project' });
  await assert.rejects(manager.list(alias), /projects\/owner-mismatch/);
  await assert.rejects(manager.get(alias, project.project.id), /projects\/owner-mismatch/);
  assert.equal((await manager.get(original, project.project.id)).project.name, 'Private project');
}));

test('the existing project RPC also rejects a foreign session', () => withProjects(async (manager, authority, ctx) => {
  const project = await manager.create(actor, { name: 'RPC' });
  authority.owners.set('foreign', { sessionId: 'foreign', organizationId: 'org', ownerPrincipalId: 'bob', revision: 'foreign-1' });
  let handler;
  ctx.provide('connection', { fetch: { register: registration => { handler = registration.fetch; return () => {}; } } });
  registerProjectConnection(ctx);
  const response = await handler(new Request('http://localhost/api/workdsh-projects', { method: 'POST', body: JSON.stringify({ endpoint: 'link-task', payload: { projectId: project.project.id, sessionId: 'foreign', title: 'wrong owner' } }) }));
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'projects/session-access-denied');
  assert.equal((await manager.get(actor, project.project.id)).tasks.length, 0);
}));
