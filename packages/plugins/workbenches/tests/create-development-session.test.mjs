import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/create-development-session.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { createNativeWorkbenchDevelopmentSession: create } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const actor = { principalId: 'member', organizationId: 'org', resolvedBy: 'fixture' };
const development = { id: 'dev-1', owner: { ownerPrincipalId: 'member', organizationId: 'org' }, target: { hostId: 'host', installationId: 'install' }, source: { hostId: 'host', directory: '/source/quality' } };
test('lost native creation receipt retries the same Session identity and binds its owner', async () => {
  const ids = []; let owner, lost = true;
  const services = {
    workdshIdentity: { profile: () => ({ principalId: 'member', resolvedBy: 'fixture', organization: { id: 'org', kind: 'personal' } }), membership: () => ({ state: 'active' }) },
    workdshAccess: { sessionOwner: () => owner, bindSession: async () => owner = development.owner },
    sessionController: { create: async request => { assert.equal(request.workspaceId, 'workspace'); assert.equal(request.agentPreset, 'cordis'); assert.equal('cwd' in request, false); ids.push(request.sessionId); if (lost) { lost = false; throw new Error('lost-response'); } return { sessionId: request.sessionId, agentPreset: 'cordis' }; } },
  };
  const ctx = { get: name => services[name], fiber: { assertActive() {} }, workspaceController: { create: async () => ({ workspace: { workspaceId: 'workspace' }, created: false }) } };
  await assert.rejects(create(ctx, actor, development, '质量分析'), /lost-response/);
  const result = await create(ctx, actor, development, '质量分析');
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  assert.equal(result.sessionId, ids[0]); assert.equal(owner.ownerPrincipalId, 'member');
});

test('missing or different Creator receipt is rejected without binding a false development session', async () => {
  for (const agentPreset of [undefined, 'standard']) {
    let binds = 0;
    const services = {
      workdshIdentity: { profile: () => ({ principalId: 'member', resolvedBy: 'fixture', organization: { id: 'org', kind: 'personal' } }), membership: () => ({ state: 'active' }) },
      workdshAccess: { sessionOwner: () => undefined, bindSession: async () => { binds++; return development.owner; } },
      sessionController: { create: async request => ({ sessionId: request.sessionId, agentPreset }) },
    };
    const ctx = { get: name => services[name], fiber: { assertActive() {} }, workspaceController: { create: async () => ({ workspace: { workspaceId: 'workspace' }, created: false }) } };
    await assert.rejects(create(ctx, actor, development, '质量分析'), /development-creator-required/);
    assert.equal(binds, 0);
  }
});

test('enterprise creation uses its protected owner service and the explicit Creator request', async () => {
  let protectedCalls = 0;
  const services = {
    workdshIdentity: { profile: () => ({ principalId: 'member', resolvedBy: 'fixture', organization: { id: 'org', kind: 'enterprise' } }), membership: () => ({ state: 'active' }) },
    workdshAccess: { sessionOwner: () => development.owner },
    sessionController: { create: async () => { throw new Error('must-use-protected-service'); } },
    workdshSessionAccess: { create: async request => { protectedCalls++; assert.equal(request.agentPreset, 'cordis'); return { sessionId: request.sessionId, agentPreset: 'cordis' }; } },
  };
  const ctx = { get: name => services[name], fiber: { assertActive() {} }, workspaceController: { create: async () => ({ workspace: { workspaceId: 'workspace' }, created: false }) } };
  const result = await create(ctx, actor, development, '质量分析');
  assert.equal(protectedCalls, 1); assert.equal(result.hostId, 'host');
});

test('existing associated session keeps its identity and is never recreated or silently switched', async () => {
  const session = { hostId: 'host', sessionId: 'existing' };
  const services = {
    workdshIdentity: { profile: () => ({ principalId: 'member', resolvedBy: 'fixture', organization: { id: 'org', kind: 'personal' } }), membership: () => ({ state: 'active' }) },
    workdshAccess: {}, sessionController: { create: async () => { throw new Error('must-not-create'); } },
  };
  assert.equal(await create({ get: name => services[name], fiber: { assertActive() {} } }, actor, { ...development, session }, '质量分析'), session);
});
