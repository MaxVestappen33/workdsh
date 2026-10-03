import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, symlink, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import Sessions from '@deepseek-ai/dsh-session';
import Identity from '../dist/desktop.js';
import { protectedFilePermissions } from '../dist/protected-file.js';
import { DesktopAuthority } from '../dist/desktop-authority.js';
import { DesktopBodySync, visibleEntries, observeDesktopSessions } from '../dist/desktop-body-sync.js';

const human = (seq, text) => ({ seq, type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } });
const assistant = (seq, text) => ({ seq, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text }] } } });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'enterprise-desktop-plugin-'));
  const config = { authFile: join(directory, 'enterprise-auth.json'), principalId: 'member-a', organizationId: 'org-a', deviceId: 'device-a' };
  const key = randomBytes(32).toString('hex');
  const state = { active: true, member: 'member-a', organization: 'org-a', device: 'device-a', backend: 'https://company.example', mustChangePassword: false, role: 'MEMBER', lostAck: false, lostDeleteAck: false, posts: [], stored: new Map(), loggedOut: false };
  const receipt = (id, record) => ({ version: 1, sessionId: 'desktop-body:fixture', deviceId: config.deviceId, clientSessionId: id,
    revision: record.revision, nextRevision: record.revision + 1, recordCount: record.deleted ? 0 : record.entries.length, deleted: !!record.deleted });
  const server = createServer(async (request, response) => {
    const send = (value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.headers.authorization !== `Bearer ${key}`) return send({}, 401);
    if (request.url === '/auth/logout') { state.loggedOut = true; return send({ local: true }); }
    if (!state.active) return send({}, 401);
    if (request.url === '/auth/me') return send({ id: state.member, organizationId: state.organization, deviceId: state.device, backendUrl: state.backend,
      role: state.role, mustChangePassword: state.mustChangePassword, displayName: 'Member A', organizationName: 'Company A', email: 'a@company.example', unexpected: 'not-relayed' });
    if (!request.url.startsWith('/visible-sessions/ingest')) return send({}, 404);
    const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('sessionId');
    if (request.method === 'DELETE') {
      const record = state.stored.get(id); if (!record) return send({}, 404);
      record.deleted = true; if (state.lostDeleteAck) { state.lostDeleteAck = false; response.destroy(); return; } return send(receipt(id, record));
    }
    if (request.method === 'GET') {
      const record = state.stored.get(id); return record ? send(receipt(id, record)) : send({}, 404);
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); state.posts.push(body);
    if (body.deviceId !== config.deviceId) return send({}, 409);
    let record = state.stored.get(body.sessionId);
    if (record?.deleted) return send({}, 410);
    if (record?.requestId === body.requestId && JSON.stringify(record.body) === JSON.stringify(body)) return send(record.receipt);
    if (!body.entries.length || body.revision !== (record?.revision ?? 0) + 1 || (record && body.entries.length <= record.entries.length) ||
        record?.entries.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(body.entries[index]))) return send({}, 409);
    record = { revision: body.revision, entries: body.entries, requestId: body.requestId, body };
    record.receipt = receipt(body.sessionId, record); state.stored.set(body.sessionId, record);
    if (state.lostAck) { state.lostAck = false; response.destroy(); return; }
    send(record.receipt);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const file = { ...config, authorityUrl: `http://127.0.0.1:${server.address().port}`, authorityKey: key, backendUrl: state.backend }; delete file.authFile;
  await writeFile(config.authFile, JSON.stringify(file), { mode: 0o600 });
  return { config, file, directory, state, authority: new DesktopAuthority(config),
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); } };
}

test('Desktop identity installs a verified fixed member and rejects expiry, role/password/account changes without local fallback', async () => {
  const f = await fixture(); const ctx = new Context(); const routes = new Map();
  ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } });
  try {
    await ctx.plugin(Identity, f.config);
    assert.equal(ctx.workdshIdentity.id, 'workdsh-enterprise-desktop');
    assert.equal((await ctx.workdshIdentity.resolve({ sessionId: 'session-a' })).principalId, 'member-a');
    assert.equal(ctx.workdshIdentity.profile().organization.kind, 'team');
    const route = routes.get('/api/auth/me');
    const response = await route.fetch(new Request('http://local/api/auth/me'));
    const body = await response.json(); assert.equal(body.desktop, true); assert.equal(body.displayName, 'Member A');
    assert.equal('unexpected' in body, false); assert.equal('authorityKey' in body, false);
    f.state.member = 'member-b';
    await assert.rejects(ctx.workdshIdentity.resolve(), /member changed|expired/);
    assert.throws(() => ctx.workdshIdentity.profile(), /expired/);
    assert.equal((await route.fetch(new Request('http://local/api/auth/me'))).status, 401);
    const logout = await routes.get('/api/auth/logout').fetch(new Request('http://local/api/auth/logout', { method: 'POST' }));
    assert.deepEqual(await logout.json(), { local: true }); assert.equal(f.state.loggedOut, true);
  } finally { await ctx.fiber.dispose(); assert.equal(routes.size, 0); await f.close(); }
  for (const mutation of [state => state.active = false, state => state.organization = 'org-b', state => state.device = 'device-b',
    state => state.backend = 'https://other.example', state => state.mustChangePassword = true]) {
    const f = await fixture(); try { mutation(f.state); await assert.rejects(f.authority.verify()); assert.equal(f.state.posts.length, 0); }
    finally { f.authority.close(); await f.close(); }
  }
});

test('authority requires a protected non-symlink file, literal loopback and immutable backend/member/device binding', async () => {
  const f = await fixture();
  try {
    await f.authority.verify(); await chmod(f.config.authFile, 0o644); await assert.rejects(f.authority.verify(), /Protected/);
    await chmod(f.config.authFile, 0o600);
    await writeFile(f.config.authFile, JSON.stringify({ ...f.file, authorityKey: randomBytes(32).toString('hex') }));
    await assert.rejects(f.authority.verify(), /changed/);
    await writeFile(f.config.authFile, JSON.stringify({ ...f.file, authorityUrl: 'http://localhost:12345' }));
    await assert.rejects(new DesktopAuthority(f.config).verify(), /literal loopback/);
    const link = join(f.directory, 'symlink.json'); await symlink(f.config.authFile, link);
    await assert.rejects(new DesktopAuthority({ ...f.config, authFile: link }).verify());
    await writeFile(f.config.authFile, JSON.stringify(f.file));
    await assert.rejects(f.authority.body('POST', 'session-a', { deviceId: 'other', sessionId: 'session-a' }), /binding/);
    assert.equal(f.state.posts.length, 0);
  } finally { f.authority.close(); await f.close(); }
});

test('visible projection excludes synthetic/system/reasoning/tools/attachments and redacts known credential shapes with stable IDs', () => {
  const secret = 'sk-' + 'a'.repeat(25);
  const events = [human(0, `Question ${secret}`), { type: 'system/message', seq: 1, data: { text: 'system' } },
    { type: 'user/message', seq: 2, data: { source: { kind: 'agent-inject' }, content: [{ type: 'text', text: 'private injected skill' }] } },
    { type: 'assistant/attempt', seq: 3, data: { text: 'failed stream' } },
    { type: 'assistant/message', seq: 4, data: { interrupted: true, message: { content: [{ type: 'reasoning', text: 'hidden thought' },
      { type: 'text', text: 'Visible reply' }, { type: 'tool-call', arguments: 'private tool' }, { type: 'file', attachment: 'private bytes' }] } } },
    { type: 'tool/result', seq: 5, data: { text: 'private output' } }];
  const entries = visibleEntries(events, 'fixed-owner', 'session-a');
  assert.deepEqual(entries.map(({ role, text, seq }) => ({ role, text, seq })), [{ seq: 0, role: 'user', text: 'Question [credential redacted]' }, { seq: 1, role: 'assistant', text: 'Visible reply' }]);
  assert.deepEqual(visibleEntries(events, 'fixed-owner', 'session-a'), entries);
  assert.notEqual(visibleEntries(events, 'other-owner', 'session-a')[0].recordId, entries[0].recordId);
  assert.equal(JSON.stringify(entries).includes(secret), false);
});

test('durable outbox retains an ambiguous request and retries exactly once across restart, then appends next revision', async () => {
  const f = await fixture(); let events = [human(0, `Question ${f.file.authorityKey}`)]; let sync;
  try {
    sync = await DesktopBodySync.create(f.authority, async () => ({ events })); f.state.lostAck = true;
    await sync.capture('session-a');
    const before = JSON.parse(await readFile(sync.file, 'utf8')); const pending = before.sessions['session-a'].pending;
    assert.ok(pending); assert.equal(JSON.stringify(before).includes(f.file.authorityKey), false); assert.equal((await sync.status()).sessions[0].acknowledged, 0);
    assert.equal((await stat(sync.file)).mode & 0o077, 0);
    sync.close(); sync = await DesktopBodySync.create(f.authority, async () => ({ events }));
    await sync.retry();
    assert.deepEqual(f.state.posts[1], pending); assert.equal(f.state.stored.get('session-a').entries.length, 1);
    assert.equal((await sync.status()).sessions[0].pending, false);
    events = [...events, assistant(1, 'Answer')]; await sync.capture('session-a');
    assert.equal(f.state.posts.at(-1).revision, 2); assert.equal(f.state.posts.at(-1).entries.length, 2);
    assert.deepEqual(f.state.posts.at(-1).entries[0], pending.entries[0]);
    assert.equal((await sync.status()).sessions[0].acknowledged, 2);
    await sync.deleteCloud('session-a'); assert.equal((await sync.status()).sessions[0].deleted, true);
    const count = f.state.posts.length; events.push(human(2, 'Later local message')); await sync.capture('session-a');
    assert.equal(f.state.posts.length, count, 'tombstoned cloud Session never resumes upload'); assert.equal(events.length, 3, 'local events are preserved');
  } finally { sync?.close(); f.authority.close(); await f.close(); }
});

test('revocation during a cold read, foreign Session denial, prefix rewrite and oversize never upload data', async () => {
  for (const scenario of ['revoked', 'foreign', 'oversize', 'prefix']) {
    const f = await fixture(); let sync; let events = [human(0, 'Original')];
    try {
      sync = await DesktopBodySync.create(f.authority, async () => {
        if (scenario === 'revoked') f.state.active = false;
        if (scenario === 'foreign') throw new Error('Session not found');
        return { events: scenario === 'oversize' ? [human(0, 'x'.repeat(65537))] : events };
      });
      if (scenario === 'prefix') { await sync.capture('session-a'); events = [human(0, 'Changed')]; }
      const before = f.state.posts.length; await sync.capture('session-a'); assert.equal(f.state.posts.length, before);
      const state = JSON.parse(await readFile(sync.file, 'utf8')); assert.ok(state.sessions['session-a'].error);
      assert.equal(JSON.stringify(state).includes('Changed'), false);
      assert.equal(JSON.stringify(state).includes('x'.repeat(65537)), false);
    } finally { sync?.close(); f.authority.close(); await f.close(); }
  }
});

test('explicit retry recaptures a Session whose authentication previously failed before its read', async () => {
  const f = await fixture(); let sync; let reads = 0;
  try {
    sync = await DesktopBodySync.create(f.authority, async () => { reads++; return { events: [human(0, 'Recovered')] }; });
    f.state.active = false; await sync.capture('session-a'); assert.equal(reads, 0); assert.equal(f.state.posts.length, 0);
    f.state.active = true; await sync.retry(); assert.equal(reads, 1); assert.equal((await sync.status()).sessions[0].acknowledged, 1);
  } finally { sync?.close(); f.authority.close(); await f.close(); }
});

test('official SessionStore creation/event/flush hooks sync committed visible text, and disposal does not delete cloud records', async () => {
  const f = await fixture(); const ctx = new Context(); let sync; const logs = new Map();
  try {
    await ctx.plugin(Sessions);
    ctx.on('session/created', session => logs.set(String(session.id), []));
    ctx.on('session/event', (session, event) => logs.get(String(session.id)).push(event));
    sync = await DesktopBodySync.create(f.authority, async id => ({ events: logs.get(id) }));
    observeDesktopSessions(ctx, sync);
    const session = ctx.sessions.create('session-real');
    session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Official prompt' }] }, { surfaceOp: 'append' });
    session.append('assistant/message', { turn: 0, step: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'Official answer' }] }, stream: [] }, { surfaceOp: 'append' });
    await ctx.sessions.flush(session); await sync.drain();
    assert.equal(f.state.stored.get('session-real').entries.length, 2);
    const before = f.state.stored.get('session-real');
    await ctx.fiber.dispose(); assert.equal(before.deleted, undefined);
  } finally { sync?.close(); await ctx.fiber.dispose(); f.authority.close(); await f.close(); }
});

test('protected file policy checks POSIX mode/uid and delegates Windows ownership to the Main userData ACL', () => {
  assert.equal(protectedFilePermissions(0o600, 100, 'darwin', 100), true);
  assert.equal(protectedFilePermissions(0o644, 100, 'darwin', 100), false);
  assert.equal(protectedFilePermissions(0o600, 101, 'linux', 100), false);
  assert.equal(protectedFilePermissions(0o666, 0, 'win32'), true);
});

test('fixed Desktop identity rejects a live role change and a denied backend without continuing cached membership', async () => {
  for (const mutation of [state => state.role = 'ADMIN', state => state.mustChangePassword = true, state => state.active = false]) {
    const f = await fixture(); const ctx = new Context();
    ctx.provide('connection', { fetch: { register() { return () => {}; } } });
    try {
      await ctx.plugin(Identity, f.config); await ctx.workdshIdentity.resolve(); mutation(f.state);
      await assert.rejects(ctx.workdshIdentity.resolve()); assert.throws(() => ctx.workdshIdentity.profile(), /expired/);
    } finally { await ctx.fiber.dispose(); await f.close(); }
  }
});

test('lost deletion acknowledgement persists a delete intent, pauses upload and retries the idempotent tombstone after restart', async () => {
  const f = await fixture(); let sync; let events = [human(0, 'Delete later')];
  try {
    sync = await DesktopBodySync.create(f.authority, async () => ({ events })); await sync.capture('session-a');
    f.state.lostDeleteAck = true; await assert.rejects(sync.deleteCloud('session-a'));
    assert.equal((await sync.status()).sessions[0].deletePending, true);
    const before = f.state.posts.length; events.push(assistant(1, 'Local only after deletion request')); await sync.capture('session-a'); assert.equal(f.state.posts.length, before);
    sync.close(); sync = await DesktopBodySync.create(f.authority, async () => ({ events })); await sync.retry();
    const row = (await sync.status()).sessions[0]; assert.equal(row.deleted, true); assert.equal(row.deletePending, false); assert.equal(f.state.posts.length, before);
    assert.equal(events.length, 2);
  } finally { sync?.close(); f.authority.close(); await f.close(); }
});
