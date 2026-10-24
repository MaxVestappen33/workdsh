import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import * as BrowserSession from '../dist/index.js';

const TOOL = 'mcp__workdsh-playwright__browser_navigate';

test('official Agent Sessions receive isolated managed Playwright tools', {
  skip: !process.env.DSH_BROWSER_EXECUTABLE && !process.env.DSH_ELECTRON_TEST_EXECUTABLE,
  timeout: 60_000,
}, async () => {
  const runtime = await import('../../../../apps/web/tests/helpers/skill-runtime.mjs');
  const {Sessions, Projections, SystemPrompt, Tools, Llm, Agents, AgentLoop} = runtime;
  const {default: BrowserUse} = await import('@deepseek-ai/dsh-browser-use');
  const ctx = new Context();
  const handles = [];
  let route;
  const profile = {
    principalId: 'local-owner',
    organization: { id: 'local-org', kind: 'personal' },
    membership: { principalId: 'local-owner', organizationId: 'local-org', state: 'active' },
  };
  try {
    ctx.provide('connection', { fetch: { register(value) { route = value; return async () => { route = undefined; }; } } });
    ctx.provide('workdshIdentity', { profile: () => profile });
    for (const plugin of [Sessions, Projections, SystemPrompt, Tools, Llm, Agents, AgentLoop, BrowserUse]) {
      await ctx.plugin(plugin);
    }
    await ctx.plugin(BrowserSession, process.env.DSH_ELECTRON_TEST_EXECUTABLE
      ? {
        electronExecutable: process.env.DSH_ELECTRON_TEST_EXECUTABLE,
        electronApplication: process.env.DSH_ELECTRON_TEST_APP_PATH,
      }
      : { executablePath: process.env.DSH_BROWSER_EXECUTABLE });
    assert.equal(route?.path, '/api/workdsh-browser-session');
    const first = await ctx.agents.create({ sessionId: randomUUID() });
    handles.push(first);
    const second = await ctx.agents.create({ sessionId: randomUUID() });
    handles.push(second);
    await Promise.all(handles.map(handle => handle.agent.whenIdle()));

    assert.equal(ctx.browserUse.providerName, 'workdsh-playwright');
    // 浏览器预热不再阻塞会话创建，工具注册会在后台完成。
    const waitForTools = async agent => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (ctx.tools.schemas(agent).some(schema => schema.name === TOOL)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('browser tools were not registered');
    };
    for (const { agent } of handles) await waitForTools(agent);
    assert.equal(ctx.workdshBrowserSession.active(first.agent), false);

    const close = agent => ctx.tools.execute({
      agent,
      name: 'mcp__workdsh-playwright__browser_close',
      arguments: {},
      callId: `close-${randomUUID()}`,
      signal: new AbortController().signal,
    });
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await close(first.agent);
      assert.equal(result.isError, false, JSON.stringify(result));
      assert.equal(ctx.workdshBrowserSession.active(first.agent), false, 'closing an untouched browser never activates its blank view');
    }
    const tabs = (agent, action, extra = {}) => ctx.tools.execute({
      agent, name: 'mcp__workdsh-playwright__browser_tabs', arguments: { action, ...extra },
      callId: `tabs-${randomUUID()}`, signal: new AbortController().signal,
    });
    assert.equal((await tabs(first.agent, 'list')).isError, false);
    assert.equal(ctx.workdshBrowserSession.active(first.agent), false, 'listing browser tabs is not page use');
    const failedNavigation = await ctx.tools.execute({
      agent: first.agent, name: TOOL, arguments: { url: 42 },
      callId: 'invalid-navigation', signal: new AbortController().signal,
    });
    assert.equal(failedNavigation.isError, true);
    assert.equal(ctx.workdshBrowserSession.active(first.agent), false, 'failed tools do not announce browser activity');

    const execute = (agent, label) => ctx.tools.execute({
      agent,
      name: TOOL,
      arguments: { url: `data:text/html,<title>${label}</title><button onclick="this.textContent='CLICKED_${label}'">${label}</button>` },
      callId: `navigate-${label}`,
      signal: new AbortController().signal,
    });
    const one = await execute(first.agent, 'FIRST_SESSION');
    const two = await execute(second.agent, 'SECOND_SESSION');
    assert.equal(one.isError, false, JSON.stringify(one));
    assert.equal(two.isError, false, JSON.stringify(two));
    assert.match(JSON.stringify(one), /FIRST_SESSION/);
    assert.match(JSON.stringify(two), /SECOND_SESSION/);
    assert.doesNotMatch(JSON.stringify(two), /FIRST_SESSION/);

    const capture = await ctx.workdshBrowserSession.capture(first.agent, new AbortController().signal);
    assert.match(capture.url, /FIRST_SESSION/);
    assert.ok(Buffer.from(capture.jpegBase64, 'base64').subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])));
    const callRoute = async (sessionId, operation, extra = {}) => {
      const result = await route.fetch(new Request('http://localhost/api/workdsh-browser-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, operation, ...extra }),
      }));
      return { status: result.status, body: await result.json() };
    };
    assert.deepEqual(await callRoute(first.agent.id, 'status'), { status: 200, body: { active: true, revision: ctx.workdshBrowserSession.revision(first.agent) } });
    assert.equal((await callRoute('unknown-session', 'capture')).status, 404);
    assert.equal((await callRoute(second.agent.id, 'capture')).body.url.includes('FIRST_SESSION'), false);
    profile.membership.principalId = 'another-owner';
    assert.equal((await callRoute(first.agent.id, 'capture')).status, 403);
    profile.membership.principalId = 'local-owner';
    const remoteFrame = await callRoute(first.agent.id, 'capture');
    assert.equal(remoteFrame.status, 200);
    assert.match(remoteFrame.body.url, /FIRST_SESSION/);
    const clicked = await callRoute(first.agent.id, 'click', { x: 62, y: 17 });
    assert.equal(clicked.status, 200);
    assert.match(clicked.body.url, /FIRST_SESSION/);
    const observed = await ctx.tools.execute({
      agent: first.agent,
      name: 'mcp__workdsh-playwright__browser_snapshot',
      arguments: {},
      callId: 'after-sidebar-click',
      signal: new AbortController().signal,
    });
    assert.equal(observed.isError, false, JSON.stringify(observed));
    assert.match(JSON.stringify(observed), /CLICKED_FIRST_SESSION/);
    await assert.rejects(ctx.workdshBrowserSession.capture({ ...first.agent }, new AbortController().signal));

    const closed = await close(first.agent);
    assert.equal(closed.isError, false, JSON.stringify(closed));
    const closedRevision = ctx.workdshBrowserSession.revision(first.agent);
    assert.deepEqual(await callRoute(first.agent.id, 'status'), { status: 200, body: { active: false, revision: closedRevision } });
    const reopened = await execute(first.agent, 'FIRST_REOPENED');
    assert.equal(reopened.isError, false, JSON.stringify(reopened));
    assert.ok(ctx.workdshBrowserSession.revision(first.agent) > closedRevision);
    assert.deepEqual(await callRoute(first.agent.id, 'status'), { status: 200, body: { active: true, revision: ctx.workdshBrowserSession.revision(first.agent) } });
    const beforeFailedClose = ctx.workdshBrowserSession.revision(first.agent);
    assert.equal((await tabs(first.agent, 'close', { index: 999 })).isError, true);
    assert.equal(ctx.workdshBrowserSession.active(first.agent), true, 'a failed close does not claim the live view was closed');
    assert.equal(ctx.workdshBrowserSession.revision(first.agent), beforeFailedClose);
    assert.equal((await tabs(first.agent, 'close')).isError, false);
    assert.equal(ctx.workdshBrowserSession.active(first.agent), false, 'closing a tab withdraws automatic display');

    await first.dispose();
    handles.splice(handles.indexOf(first), 1);
    assert.equal(ctx.tools.schemas(first.agent).some(schema => schema.name === TOOL), false);
    await assert.rejects(ctx.workdshBrowserSession.capture(first.agent, new AbortController().signal));
    assert.equal((await callRoute(first.agent.id, 'capture')).status, 404);
    const stillLive = await execute(second.agent, 'SECOND_STILL_LIVE');
    assert.equal(stillLive.isError, false, JSON.stringify(stillLive));
    assert.match(JSON.stringify(stillLive), /SECOND_STILL_LIVE/);
  } finally {
    for (const handle of handles.reverse()) await handle.dispose();
    await ctx.fiber.dispose();
  }
});
