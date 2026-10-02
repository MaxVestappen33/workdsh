import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import * as Plugin from '../dist/index.js';
import { enterpriseMemberCollaboration } from '../dist/member.js';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const tokens = new Map([['member-a-123456789012345678901234', a], ['member-b-123456789012345678901234', b]]);
const handoffs = [];
const messages = [];
const view = (handoff, actor) => {
  const last = messages.filter(item => item.handoffId === handoff.id).at(-1);
  return { ...handoff, lastMessageAt: last?.createdAt ?? null,
    needsReply: handoff.status === 'OPEN' && (last ? last.authorId !== actor : handoff.recipientId === actor) };
};
let revoked = false;
let collaborationContractVersion = 1;
const server = createServer(async (request, response) => {
  const actor = tokens.get(request.headers.authorization?.slice(7));
  response.setHeader('content-type', 'application/json');
  if (!request.headers.authorization?.startsWith('Bearer ') || !actor || (revoked && actor === a)) {
    response.writeHead(401).end('{}'); return;
  }
  const path = request.url;
  const send = (value, code = 200) => response.writeHead(code).end(JSON.stringify(value));
  if (path === '/api/auth/me') return send({ id: actor, organizationId: 'org' });
  if (path === '/api/collaboration/contract') return send({ contractVersion: collaborationContractVersion });
  if (path === '/api/collaboration/colleagues') return send([{ id: actor === a ? b : a, displayName: actor === a ? '乙' : '甲', email: actor === a ? 'b@example.test' : 'a@example.test' }]);
  if (path === '/api/collaboration/inbox') return send(handoffs.filter(h => h.recipientId === actor).map(h => view(h, actor)));
  if (path === '/api/collaboration/sent') return send(handoffs.filter(h => h.senderId === actor).map(h => view(h, actor)));
  if (path === '/api/collaboration/handoffs' && request.method === 'POST') {
    const body = JSON.parse(await read(request));
    if (actor !== a || body.recipientId !== b) return response.writeHead(400).end('{}');
    const existing = handoffs.find(h => h.senderId === actor && h.requestKey === body.requestKey);
    if (existing) return send(view(existing, actor), 201);
    const h = { id: randomUUID(), senderId: a, senderName: '甲', recipientId: b, recipientName: '乙',
      summary: body.summary, requestKey: body.requestKey, status: 'OPEN', resolution: null,
      createdAt: new Date().toISOString(), completedAt: null };
    handoffs.push(h); return send(view(h, actor), 201);
  }
  if (path?.endsWith('/complete') && request.method === 'POST') {
    const h = handoffs.find(item => path.includes(item.id) && item.recipientId === actor && item.status === 'OPEN');
    if (!h) return response.writeHead(409).end('{}');
    h.status = 'DONE'; h.resolution = JSON.parse(await read(request)).resolution; h.completedAt = new Date().toISOString();
    return send(view(h, actor));
  }
  const thread = path?.match(/^\/api\/collaboration\/handoffs\/([^/]+)\/messages$/);
  if (thread) {
    const h = handoffs.find(item => item.id === thread[1] && (item.senderId === actor || item.recipientId === actor));
    if (!h) return response.writeHead(404).end('{}');
    if (request.method === 'GET') return send(messages.filter(item => item.handoffId === h.id));
    if (h.status !== 'OPEN') return response.writeHead(409).end('{}');
    const body = JSON.parse(await read(request));
    const existing = messages.find(item => item.handoffId === h.id && item.authorId === actor && item.requestKey === body.requestKey);
    if (existing) return send(existing, 201);
    const message = { id: randomUUID(), handoffId: h.id, authorId: actor, authorName: actor === a ? '甲' : '乙',
      content: body.content, requestKey: body.requestKey, createdAt: new Date().toISOString() };
    messages.push(message); return send(message, 201);
  }
  response.writeHead(404).end('{}');
});
function read(request) { return new Promise((resolve, reject) => { let data = ''; request.on('data', c => data += c); request.on('end', () => resolve(data)); request.on('error', reject); }); }
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());
const adminUrl = `http://127.0.0.1:${server.address().port}`;

async function instance(member, memberToken) {
  const ctx = new Context();
  let route;
  ctx.provide('connection', { fetch: { register(handler) { route = handler; return () => { route = undefined; }; } } });
  ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 0; } });
  ctx.provide('workdshIdentity', { async resolve() { return { principalId: member, organizationId: 'org' }; } });
  await ctx.plugin(Tools);
  const fiber = await ctx.plugin(enterpriseMemberCollaboration(adminUrl, async () => `Bearer ${memberToken}`));
  async function call(name, args = {}, callId = randomUUID()) {
    return ctx.tools.execute({ name, arguments: args, callId,
      agent: { id: `session-${member}` }, signal: new AbortController().signal });
  }
  return { ctx, fiber, call, route: request => route.fetch(request) };
}

async function settle(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), 'Cordis Fiber lifecycle settles');
}

test('handoff plugin waits for enterprise identity instead of exposing unusable tools', async () => {
  const ctx = new Context();
  try {
    ctx.provide('connection', { fetch: { register() { return () => {}; } } });
    ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 0; } });
    await ctx.plugin(Tools);
    const fiber = ctx.plugin(Plugin, { adminUrl, memberAuthorization: async () => `Bearer ${[...tokens.keys()][0]}` });
    assert.equal(fiber.state, 0, 'missing required identity keeps Fiber PENDING');
    assert.equal(ctx.tools.get('workdsh_collaboration_send'), undefined);
    ctx.provide('workdshIdentity', { async resolve() { return { principalId: a, organizationId: 'org' }; } });
    await settle(() => fiber.state === 2);
    assert.ok(ctx.tools.get('workdsh_collaboration_send'), 'tool appears after dependency activates');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('invalid collaboration service origin leaves Fiber FAILED with no registered tools', async () => {
  const ctx = new Context();
  try {
    ctx.provide('connection', { fetch: { register() { return () => {}; } } });
    ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 0; } });
    ctx.provide('workdshIdentity', { async resolve() { return { principalId: a, organizationId: 'org' }; } });
    await ctx.plugin(Tools);
    const fiber = ctx.plugin(Plugin, {
      adminUrl: 'http://example.com', memberAuthorization: async () => `Bearer ${[...tokens.keys()][0]}`,
    });
    await settle(() => fiber.state === 3);
    assert.match(fiber._error.message, /requires HTTPS except on loopback/);
    assert.equal(ctx.tools.get('workdsh_collaboration_send'), undefined);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('two isolated official tool registries hand off to a real member inbox and return a result', async () => {
  const first = await instance(a, [...tokens.keys()][0]);
  const second = await instance(b, [...tokens.keys()][1]);
  try {
    for (const ctx of [first.ctx, second.ctx]) {
      const names = ctx.tools.schemas({ id: 'session' }).map(t => t.name);
      for (const name of ['workdsh_collaboration_colleagues', 'workdsh_collaboration_send', 'workdsh_collaboration_inbox',
        'workdsh_collaboration_sent', 'workdsh_collaboration_complete', 'workdsh_collaboration_thread',
        'workdsh_collaboration_reply']) assert.ok(names.includes(name), name);
    }
    const people = await first.call('workdsh_collaboration_colleagues');
    assert.equal(JSON.parse(people.value.data_json)[0].id, b);
    assert.equal(JSON.parse(people.value.data_json)[0].email, 'b@example.test');
    const uiList = await first.route(new Request(`${adminUrl}/api/workdsh-collaboration`, {
      method: 'POST', body: JSON.stringify({ endpoint: 'colleagues' }),
    }));
    assert.equal((await uiList.json()).value[0].id, b);
    const sent = await first.call('workdsh_collaboration_send', { recipient_id: b, summary: '请复核这份分析' }, 'same-call');
    assert.equal(sent.isError, false);
    const id = JSON.parse(sent.value.data_json).id;
    await first.call('workdsh_collaboration_send', { recipient_id: b, summary: '请复核这份分析' }, 'same-call');
    assert.equal(handoffs.length, 1, 'replayed call must not duplicate handoff');
    const inbox = await second.call('workdsh_collaboration_inbox');
    assert.equal(JSON.parse(inbox.value.data_json)[0].id, id);
    assert.equal(JSON.parse(inbox.value.data_json)[0].needsReply, true);
    const asked = await second.call('workdsh_collaboration_reply', {
      handoff_id: id, content: '请补充计算依据',
    }, 'reply-question');
    assert.equal(JSON.parse(asked.value.data_json).authorId, b);
    assert.equal(JSON.parse((await first.call('workdsh_collaboration_sent')).value.data_json)[0].needsReply, true);
    assert.equal(JSON.parse((await second.call('workdsh_collaboration_inbox')).value.data_json)[0].needsReply, false);
    await second.call('workdsh_collaboration_reply', { handoff_id: id, content: '请补充计算依据' }, 'reply-question');
    assert.equal(messages.filter(item => item.handoffId === id).length, 1);
    const thread = await first.call('workdsh_collaboration_thread', { handoff_id: id });
    assert.equal(JSON.parse(thread.value.data_json)[0].content, '请补充计算依据');
    const answered = await first.route(new Request(`${adminUrl}/api/workdsh-collaboration`, {
      method: 'POST', body: JSON.stringify({ endpoint: 'reply', handoffId: id,
        content: '8 × 120 = 960', requestKey: 'ui-answer' }),
    }));
    assert.equal((await answered.json()).value.content, '8 × 120 = 960');
    assert.equal(JSON.parse((await second.call('workdsh_collaboration_thread', { handoff_id: id })).value.data_json).length, 2);
    assert.equal(JSON.parse((await second.call('workdsh_collaboration_inbox')).value.data_json)[0].needsReply, true);
    const completed = await second.call('workdsh_collaboration_complete', { handoff_id: id, resolution: '已核对，需改两处' });
    assert.equal(JSON.parse(completed.value.data_json).status, 'DONE');
    const reply = await first.call('workdsh_collaboration_sent');
    assert.equal(JSON.parse(reply.value.data_json)[0].resolution, '已核对，需改两处');
    revoked = true;
    const denied = await first.call('workdsh_collaboration_sent');
    assert.equal(denied.isError, true);
    assert.equal((await second.call('workdsh_collaboration_inbox')).isError, false);
  } finally {
    revoked = false;
    await first.fiber.dispose(); await second.fiber.dispose();
    assert.equal(first.ctx.tools.get('workdsh_collaboration_send'), undefined);
    await first.ctx.fiber.dispose(); await second.ctx.fiber.dispose();
  }
});

test('a mismatched DSH principal cannot call the member service', async () => {
  const ctx = new Context();
  ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 0; } });
  ctx.provide('workdshIdentity', { async resolve() { return { principalId: b, organizationId: 'org' }; } });
  await ctx.plugin(Tools);
  const fiber = await ctx.plugin(Plugin, { adminUrl, memberAuthorization: async () => `Bearer ${[...tokens.keys()][0]}` });
  const result = await ctx.tools.execute({ name: 'workdsh_collaboration_colleagues', arguments: {}, callId: 'mismatch',
    agent: { id: 'session-mismatch' }, signal: new AbortController().signal });
  assert.equal(result.isError, true);
  await fiber.dispose(); await ctx.fiber.dispose();
});

test('an incompatible collaboration contract prevents writes before creating a handoff', async () => {
  const first = await instance(a, [...tokens.keys()][0]);
  const count = handoffs.length;
  try {
    collaborationContractVersion = 2;
    const result = await first.call('workdsh_collaboration_send', {
      recipient_id: b, summary: '不能写入不兼容的服务',
    });
    assert.equal(result.isError, true);
    assert.equal(handoffs.length, count);
  } finally {
    collaborationContractVersion = 1;
    await first.fiber.dispose(); await first.ctx.fiber.dispose();
  }
});


test('missing Host member authorization produces a clear failure', () => {
  assert.throws(() => new Plugin.CollaborationClient({ adminUrl }), /Host memberAuthorization callback/);
});
