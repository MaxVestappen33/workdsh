import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Agents from '@deepseek-ai/dsh-agent';
import McpResources from '@deepseek-ai/dsh-mcp-resources';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domain from '@deepseek-ai/dsh-storage-domain';
import Tools from '@deepseek-ai/dsh-tools';
import { ConnectorManager } from '../../../../packages/plugins/connectors/dist/index.js';
import { installNodePackage, packageNameOf, removeNodePackage } from '../../../../packages/plugins/connectors/dist/install-package.js';
import { ConnectorMarketClient } from '../../../../packages/plugins/connectors/dist/market.js';
import { ConnectorMarketService } from '../../../../packages/plugins/connectors/dist/market-entry.js';
import { startNpmRegistryStub } from '../../scripts/fixtures/npm-registry-stub.mjs';

/** 随包 Node 与随包 pnpm 在真机上由载体注入；测试里分别用当前进程与工作区自带的 pnpm 代替。 */
const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const pnpm = join(webRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
const exampleServer = fileURLToPath(new URL('../../../../packages/plugins/connectors/dist/example-server.mjs', import.meta.url));
const marketPaths = { list: '/market/list', categories: '/market/categories', install: '/market/install', uninstall: '/market/uninstall' };

/** 后台市场接口的最小替身：列表下发条目，安装/卸载只记录上报行为。 */
function fakeBackend(entries) {
  const reports = [];
  return {
    reports,
    available: async () => true,
    get: async path => path === marketPaths.list
      ? { records: entries, total: entries.length, current: 1 }
      : [],
    post: async (path, body) => {
      reports.push({ path, body });
      return {};
    },
  };
}

/** 组装一个只含连接器与市场的最小 Host：和 probe-connectors 的口径一致，只放行会话校验。 */
async function startConnectors(root, entries, marketOptions) {
  const ctx = new Context();
  ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 0; } });
  ctx.provide('connection', { fetch: { register() { return async () => {}; } } });
  ctx.provide('workdshSessionAccess', { async inspect(id) { return { meta: { id }, events: [] }; } });
  await ctx.plugin(Tools);
  await ctx.plugin(Storage);
  await ctx.plugin({ ...JsonStorage }, { root: join(root, 'storage') });
  await ctx.plugin({ ...Domain }, { backend: 'json' });
  ctx.provide('credentials', {});
  await ctx.plugin(McpResources);
  await ctx.plugin(Agents);
  await ctx.plugin(ConnectorManager, { seedExample: false });
  const backend = fakeBackend(entries);
  ctx.provide('workdshBackend', backend);
  await ctx.plugin(ConnectorMarketService, { paths: marketPaths, ...marketOptions });
  return { ctx, backend, market: ctx.workdshConnectorMarket };
}

const waitFor = async (predicate, timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待安装任务结束时超时。');
};

test('market entries map package-manager launches to an installable package', async () => {
  const client = new ConnectorMarketClient({
    paths: marketPaths,
    backend: fakeBackend([
      { id: 'chrome', serviceId: 'chrome-devtools', name: 'Chrome DevTools', transport: 'stdio', command: 'npx', args: ['chrome-devtools-mcp@latest', '--channel=canary'] },
      { id: 'node', serviceId: 'local-node', name: '本地 Node MCP', transport: 'stdio', command: 'node', args: ['/opt/mcp/server.js'] },
      { id: 'dlx', serviceId: 'dlx-pkg', name: 'dlx 包', transport: 'stdio', command: 'pnpm', args: ['dlx', 'some-mcp@1.2.3', '--port=1'] },
      { id: 'http', serviceId: 'remote', name: '远程 MCP', transport: 'http', endpoint: 'https://mcp.example.com/mcp' },
    ]),
  });
  const items = new Map((await client.list()).items.map(item => [item.originId, item]));
  assert.equal(items.get('chrome').launch, 'package');
  assert.equal(items.get('chrome').packageSpec, 'chrome-devtools-mcp@latest');
  assert.deepEqual(items.get('chrome').packageArgs, ['--channel=canary']);
  assert.equal(items.get('node').launch, 'direct');
  assert.equal(items.get('dlx').packageSpec, 'some-mcp@1.2.3');
  assert.deepEqual(items.get('dlx').packageArgs, ['--port=1']);
  assert.equal(items.get('http').launch, 'direct');
});

test('package spec parsing and installation directory safety', async () => {
  assert.equal(packageNameOf('chrome-devtools-mcp@latest'), 'chrome-devtools-mcp');
  assert.equal(packageNameOf('@scope/pkg@1.2.3'), '@scope/pkg');
  assert.equal(packageNameOf('@scope/pkg'), '@scope/pkg');
  const root = await mkdtemp(join(tmpdir(), 'workdsh-mcp-root-'));
  try {
    // 只有带 package.json 的目录才认定是本安装器的产物，其它同名目录一律不动。
    await mkdir(join(root, 'installed'), { recursive: true });
    await writeFile(join(root, 'installed', 'package.json'), '{"name":"installed"}\n');
    await mkdir(join(root, 'not-ours'), { recursive: true });
    await writeFile(join(root, 'not-ours', 'keep.txt'), 'keep\n');
    await removeNodePackage(root, 'installed');
    await removeNodePackage(root, 'not-ours');
    await removeNodePackage(root, '../installed');
    assert.equal(existsSync(join(root, 'installed')), false);
    assert.equal(existsSync(join(root, 'not-ours', 'keep.txt')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installing from the offline registry resolves the entry and wipes stale files', async () => {
  const stub = await startNpmRegistryStub([{ name: 'offline-mcp', version: '1.0.0', entry: exampleServer }]);
  const root = await mkdtemp(join(tmpdir(), 'workdsh-mcp-install-'));
  try {
    const options = { registry: stub.registry, node: process.execPath, pnpm, root, serverName: 'offline-mcp', spec: 'offline-mcp@1.0.0' };
    const first = await installNodePackage(options);
    assert.equal(first.packageName, 'offline-mcp');
    assert.equal(first.version, '1.0.0');
    assert.equal(existsSync(first.entry), true);
    await writeFile(join(first.directory, 'stale.txt'), 'stale\n');
    const second = await installNodePackage(options);
    assert.equal(second.entry, first.entry);
    assert.equal(existsSync(join(second.directory, 'stale.txt')), false);
  } finally {
    await stub.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('market install downloads the package, starts the MCP and cleans up on uninstall', async () => {
  const stub = await startNpmRegistryStub([{ name: 'offline-mcp', version: '1.0.0', entry: exampleServer }]);
  const root = await mkdtemp(join(tmpdir(), 'workdsh-mcp-market-'));
  const installRoot = join(root, 'mcp');
  const { ctx, backend, market } = await startConnectors(root, [
    { id: 'offline', serviceId: 'offline-mcp', name: '离线 MCP', description: '从内网仓库安装', transport: 'stdio', command: 'npx', args: ['offline-mcp@1.0.0', '--quiet'] },
  ], { install: { registry: stub.registry, node: process.execPath, pnpm, root: installRoot } });
  try {
    await market.list();
    const started = await market.install('offline');
    assert.equal(started.state, 'installing');
    const task = await waitFor(async () => {
      const current = await market.installStatus('offline');
      return current && current.state !== 'installing' ? current : undefined;
    });
    assert.equal(task.state, 'ready', task.message);
    const rows = await ctx.workdshConnectors.list();
    assert.equal(rows.length, 1);
    const config = await ctx.workdshConnectors.config(rows[0].id);
    assert.equal(config.command, process.execPath);
    assert.equal(config.args[0], join(installRoot, 'offline-mcp', 'node_modules', 'offline-mcp', 'bin', 'cli.mjs'));
    assert.deepEqual(config.args.slice(1), ['--quiet']);
    const ready = await waitFor(async () => {
      const row = (await ctx.workdshConnectors.list())[0];
      return row?.state === 'ready' ? row : undefined;
    });
    assert.equal(ready.toolNames.length, 2);
    const uninstalled = await market.uninstall({ originId: 'offline' });
    assert.equal(uninstalled.uninstalled, true);
    assert.equal((await ctx.workdshConnectors.list()).length, 0);
    assert.equal(existsSync(join(installRoot, 'offline-mcp')), false);
    assert.deepEqual(backend.reports.map(report => report.path), [marketPaths.install, marketPaths.uninstall]);
  } finally {
    await ctx.fiber.dispose();
    await stub.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('market install fails visibly when the carrier injected no package registry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-mcp-noregistry-'));
  const { ctx, market } = await startConnectors(root, [
    { id: 'offline', serviceId: 'offline-mcp', name: '离线 MCP', transport: 'stdio', command: 'npx', args: ['offline-mcp@1.0.0'] },
  ], {});
  try {
    await market.list();
    await market.install('offline');
    const task = await waitFor(async () => {
      const current = await market.installStatus('offline');
      return current && current.state !== 'installing' ? current : undefined;
    });
    assert.equal(task.state, 'failed');
    assert.match(task.message, /未配置内网包仓库/u);
    assert.equal((await ctx.workdshConnectors.list()).length, 0);
  } finally {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
