import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, realpath, copyFile, unlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { checkProfessionalSession } from './check-expert-professional-session.mjs';
import { expertDraftUrl } from '../../../packages/plugins/experts/dist/domain/navigation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const scenario = process.argv[2] || 'normal';
assert.ok(['normal', 'incomplete', 'dirty'].includes(scenario), 'Scenario must be normal, incomplete or dirty');
const runLabel = process.argv[3] || '';
const confirmed=process.argv[4]==='--confirmed';
assert.ok(!process.argv[4]||confirmed,'Only --confirmed is supported');
assert.ok(!confirmed||scenario==='dirty','Confirmed scope applies only to dirty fixture');
assert.ok(!runLabel || /^[a-z0-9-]{1,40}$/.test(runLabel), 'Run label must contain lowercase letters, digits or hyphens');
const artifacts = join(root, '.artifacts/expert-conversation-entry');
const home = await realpath(await mkdtemp(join(tmpdir(), 'workdsh-experts-professional-')));
await mkdir(artifacts, { recursive: true });
await unlink(join(artifacts, 'report.json')).catch(() => {});
const workspace = join(home, 'workspace');
await mkdir(workspace);
const fixtures = join(root, 'tests/fixtures/experts/retail-analysis');
const skillRoot = join(home, 'agents/skills/retail-analysis-acceptance');
await mkdir(skillRoot, { recursive: true });
await copyFile(join(fixtures, 'SKILL.md'), join(skillRoot, 'SKILL.md'));
await copyFile(join(fixtures, `${scenario}.csv`), join(workspace, 'input.csv'));
const inputHash = createHash('sha256').update(await readFile(join(workspace, 'input.csv'))).digest('hex');
await mkdir(join(home, 'storages'));
const workspaceId = randomUUID();
const now = new Date().toISOString();
await writeFile(join(home, 'storages/workspace.json'), JSON.stringify({
  unit: { name: 'workspace', version: 2 },
  global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
  tables: { workspaces: { [workspaceId]: { path: workspace, title: 'Expert test', sessionIds: [], createdAt: now, updatedAt: now } } },
}));
const env = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), PATH: `${join(root, 'node_modules/.bin')}:${dirname(process.execPath)}:${process.env.PATH}` };
const dsh = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
const pnpm = join(root, 'node_modules/pnpm/bin/pnpm.cjs');
const exec = promisify(execFile);
const command = async (bin, args, cwd = home) => (await exec(process.execPath, [bin, ...args], { cwd, env, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
const cli = (...args) => command(dsh, args);
let server, browser, log = '';
const browserErrors = [];
const checks = [];
const pass = text => { checks.push(text); console.log(`PASS: ${text}`); };
async function start() {
  log = '';
  server = spawn(process.execPath, [dsh, '--profile', 'experts', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', value => { log += value; });
  server.stderr.on('data', value => { log += value; });
  const deadline = Date.now() + 25_000;
  while (!/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/.test(log)) {
    if (server.exitCode !== null || Date.now() > deadline) throw new Error(`Host startup failed: ${log.replace(/token=[^\s]+/g, 'token=[redacted]').slice(-2500)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const loginUrl = log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)[0];
  let response;
  while (!response) {
    try { response = await fetch(loginUrl, { redirect: 'manual', signal: AbortSignal.timeout(2000) }); }
    catch {
      if (server.exitCode !== null || Date.now() > deadline) throw new Error(`Host unavailable: ${log.replace(/token=[^\s]+/g, 'token=[redacted]').slice(-4500)}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(cookie);
  return { address: new URL(loginUrl).origin, cookie };
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = new Promise(resolve => server.once('close', resolve));
  server.kill('SIGTERM');
  const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
  await stopped; clearTimeout(timer);
}
async function api(host, endpoint, payload = {}) {
  const response = await fetch(`${host.address}/api/workdsh-experts`, { method: 'POST', headers: { cookie: host.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }), signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
let credential;
try {
  const tarballs = [];
  for (const directory of ['../../packages/providers/identity-local', '../../packages/plugins/audit', '../../packages/plugins/access', '../../packages/plugins/skills', '../../packages/plugins/experts', '../../packages/plugins/library', '../../packages/plugins/connectors', '../../packages/bundle']) {
    const manifest = JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8'));
    await command(pnpm, ['--filter', manifest.name, 'pack', '--pack-destination', artifacts], root);
    tarballs.push(join(artifacts, `${manifest.name}-${manifest.version}.tgz`));
  }
  await cli('--profile', 'experts', '--from-default-profile', 'web', '--dump-config');
  await cli('plugin', '--profile', 'experts', 'add', ...tarballs, '--offline');
  const host = await start();
  pass('Eight independent installed packages use a temporary Home and synthetic workspace');
  const drafted = await api(host, 'create-draft', { operationId: 'professional-create', definition: {
    name: '门店经营分析验收专家', description: '核对合成门店数据，拆解指标变化，交付可审计报告。',
    role: '你是业务数据分析专家。用实际计算核对金额、转化与门店贡献；不虚构行业履历或数据。',
    methodology: '先检查数据完整性与计价单位，再计算对比和门店贡献，交叉核对；区分算术驱动、事实和待验证假设。',
    boundaries: '仅操作当前合成工作区。原始 input.csv 不可修改。不得联网、安装依赖、读取凭据或其他用户文件。',
    deliverables: '生成 analysis-results.json 和 analysis-report.md，给出可核验指标、局限及后续行动。',
    tags: ['经营分析', '合成数据'], examples: [{ id: 'retail', title: '月度经营诊断', prompt: (await readFile(join(fixtures, 'prompt.md'), 'utf8')).trim() }],
    skillRequirements: [{ name: 'retail-analysis-acceptance', skillId: 'retail-analysis-acceptance' }], futureRequirements: [],
  } });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.context().addCookies(host.cookie.split('; ').map(pair => { const at = pair.indexOf('='); return { name: pair.slice(0, at), value: pair.slice(at + 1), url: host.address }; }));
  await page.goto(`${host.address}/${expertDraftUrl(drafted.expertId)}`);
  for (const name of ['Continue', 'Configure later']) await page.getByRole('button', { name, exact: true }).click({ timeout: 4000 }).catch(() => {});
  await expect(page.getByRole('dialog', { name: '编辑专家草稿', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('button', { name: '确认发布此版本', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '发布成功', exact: true })).toBeVisible();
  const published = await api(host, 'get', { expertId: drafted.expertId });
  assert.equal(published.revision.dependencyLock.length, 1);
  await page.getByRole('button', { name: '去试试', exact: true }).click();
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.fill('EXPERT-COMPOSER-DRAFT-验收：请分析本地数据');
  await expect(page.getByRole('button', { name: '召唤专家', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '召唤专家', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '召唤专家', exact: true });
  await expect(picker).toBeVisible();
  const choice = picker.getByRole('button', { name: /门店经营分析验收专家/ });
  await expect(choice).toBeEnabled();
  await page.screenshot({ path: join(artifacts, 'picker.png'), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(editor).toHaveText('EXPERT-COMPOSER-DRAFT-验收：请分析本地数据');
  pass('Cancel preserves the current conversation draft');
  await page.getByRole('button', { name: '召唤专家', exact: true }).click();
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/workdsh-experts') && response.request().postDataJSON()?.endpoint === 'create-execution');
  await choice.click();
  const creation = (await (await createdResponse).json()).value;
  const binding = await api(host, 'verify-binding', { sessionId: creation.sessionId });
  assert.equal(binding.expertRevisionRef.expertId, drafted.expertId);
  await expect(editor).toHaveText('EXPERT-COMPOSER-DRAFT-验收：请分析本地数据');
  await expect(picker).toHaveCount(0);
  await page.screenshot({ path: join(artifacts, 'summoned.png'), fullPage: true });
  pass('Conversation summon creates a bound native Session and transfers the draft without sending');
  await page.locator('button').filter({ hasText: 'New Session' }).first().click();
  await expect(page.getByRole('button', { name: '召唤专家', exact: true })).toBeVisible();
  await editor.fill('NEW-SESSION-EXPERT-DRAFT');
  await page.getByRole('button', { name: '召唤专家', exact: true }).click();
  await expect(choice).toBeEnabled();
  await choice.click();
  await expect(editor).toHaveText('NEW-SESSION-EXPERT-DRAFT');
  pass('New conversation composer also summons experts and preserves its draft');
  await page.reload();
  for (const name of ['Continue', 'Configure later']) await page.getByRole('button', { name, exact: true }).click({ timeout: 4000 }).catch(() => {});
  await expect(page.getByRole('button', { name: '召唤专家', exact: true })).toBeVisible();
  pass('Expert conversation entry survives page reload');
  const featureApi = async (feature, endpoint, payload = {}) => {
    const response = await fetch(`${host.address}/api/workdsh-${feature}`, { method: 'POST', headers: { cookie: host.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }) });
    const result = await response.json(); assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
  };
  const folder = await featureApi('library', 'create-folder', { name: '浮层验收资料' });
  await featureApi('library', 'import', { parentId: folder.id, name: '浮层体验验收.md', mediaType: 'text/markdown', base64: Buffer.from('# 浮层体验验收\n内容用于对话引用').toString('base64'), operationId: 'composer-library-import' });
  await editor.fill('保留原草稿');
  const libraryButton = page.getByRole('button', { name: '从资料库添加到对话', exact: true });
  await libraryButton.click();
  const libraryPicker = page.getByRole('dialog', { name: '资料库', exact: true });
  await expect(libraryPicker).toBeVisible();
  await libraryPicker.getByRole('button', { name: '打开 浮层验收资料', exact: true }).click();
  await expect(libraryPicker.getByRole('button', { name: '添加 浮层体验验收.md', exact: true })).toBeEnabled();
  await page.screenshot({ path: join(artifacts, 'library-picker.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(libraryPicker).toHaveCount(0);
  await expect(editor).toHaveText('保留原草稿');
  await libraryButton.click();
  await libraryPicker.getByRole('button', { name: '打开 浮层验收资料', exact: true }).click();
  await libraryPicker.getByRole('button', { name: '添加 浮层体验验收.md', exact: true }).click();
  await expect(libraryPicker).toHaveCount(0);
  await expect(editor).toContainText('保留原草稿');
  await expect(editor).toContainText('浮层体验验收.md');
  pass('Library popover browses folders, cancels without mutation and adds a native reference preserving text');
  await libraryButton.click();
  await libraryPicker.getByRole('button', { name: '管理资料库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '资料库', exact: true })).toBeVisible();
  pass('Library management footer opens its existing page');
  await page.locator('button').filter({ hasText: 'New Session' }).first().click();
  await featureApi('connectors', 'create', { title: '浮层 MCP 验收', description: '连接器选择体验验收', serverName: 'composer-acceptance', transport: 'stdio', command: process.execPath, args: [join(root, '../../packages/plugins/connectors/dist/example-server.mjs')] });
  const connectorButton = page.getByRole('button', { name: '连接器', exact: true });
  await connectorButton.click();
  const connectors = page.getByRole('menu', { name: '连接器', exact: true });
  const useConnector = connectors.getByRole('button', { name: '用于本次对话 浮层 MCP 验收', exact: true });
  await expect(useConnector).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'connector-picker.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(connectors).toHaveCount(0);
  await connectorButton.click();
  await useConnector.click();
  await expect(connectors.getByRole('button', { name: '从本次对话移除 浮层 MCP 验收', exact: true })).toHaveText('已选', { timeout: 20000 });
  await page.keyboard.press('Escape');
  await editor.fill('组合任务草稿');
  await libraryButton.click();
  await libraryPicker.getByRole('button', { name: '打开 浮层验收资料', exact: true }).click();
  await libraryPicker.getByRole('button', { name: '添加 浮层体验验收.md', exact: true }).click();
  await expect(editor.locator('[data-composer-chip="workdsh-library"]')).toHaveCount(1);
  await page.getByRole('button', { name: '召唤专家', exact: true }).click();
  const comboResponse = page.waitForResponse(response => response.url().endsWith('/api/workdsh-experts') && response.request().postDataJSON()?.endpoint === 'create-execution');
  await choice.click();
  const comboCreation = (await (await comboResponse).json()).value;
  await expect(picker).toHaveCount(0);
  await expect(editor).toContainText('组合任务草稿');
  await expect(editor.locator('[data-composer-chip="workdsh-library"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '连接器：浮层 MCP 验收', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '召唤专家', exact: true })).toContainText('门店经营分析验收专家');
  const selectedLibrary = await featureApi('library', 'task-selection', { sessionId: comboCreation.sessionId });
  assert.equal(selectedLibrary.length, 1);
  assert.equal(selectedLibrary[0].name, '浮层体验验收.md');
  const selectedMcp = await featureApi('connectors', 'selection', { sessionId: comboCreation.sessionId });
  assert.equal(selectedMcp.length, 1);
  await editor.locator('[data-composer-chip="workdsh-library"]').click();
  await expect(page.getByText('内容用于对话引用', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'expert-library-mcp-handoff.png'), animations: 'disabled' });
  pass('Expert handoff preserves clickable Library chips, target task selection and MCP selection');
  await page.getByRole('button', { name: '连接器：浮层 MCP 验收', exact: true }).click();
  await connectors.getByRole('button', { name: '从本次对话移除 浮层 MCP 验收', exact: true }).click();
  await expect(useConnector).toHaveText('使用');
  pass('MCP popover selects and removes a real local connector, with Escape dismissal');
  await connectors.getByRole('button', { name: '管理连接器', exact: true }).click();
  await expect(connectors).toHaveCount(0);
  pass('MCP management footer dismisses the picker and opens management');
  assert.deepEqual(browserErrors, []);
  await writeFile(join(artifacts, 'report.json'), JSON.stringify({ checks, sessionId: creation.sessionId, home }, null, 2));
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }); await writeFile(join(artifacts, 'failure-text.txt'), await page.locator('body').innerText()); }
  console.error(String(error.message).replace(/token=[^\s]+/g, 'token=[redacted]').slice(0, 1800));
  process.exitCode = 1;
} finally {
  await browser?.close(); await stop();
  await writeFile(join(artifacts, 'host.log'), log.replace(/token=[^\s]+/g, 'token=[redacted]'));
}
