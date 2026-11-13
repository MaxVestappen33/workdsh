import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

/**
 * DSH 升级门禁：官方导出面变了，这里先红，避免诊断包在客户机上悄悄退化成“只有日志”。
 * 优先用打包运行时里那份（客户机实际执行的版本），退回 pnpm 存储目录。
 */
const OFFICIAL = '@deepseek-ai/dsh-session-log-export';
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

function officialDirectory() {
  const packaged = join(REPO, 'apps/desktop/build/workdsh-runtime/profiles/workdsh/node_modules/@deepseek-ai/dsh-session-log-export');
  if (existsSync(join(packaged, 'package.json'))) return packaged;
  const store = join(REPO, 'apps/web/node_modules/.pnpm');
  const entry = readdirSync(store).find((name) => name.startsWith('@deepseek-ai+dsh-session-log-export@'));
  if (!entry) throw new Error(`${OFFICIAL} is not installed; run the web install or rebuild the desktop runtime`);
  return join(store, entry, 'node_modules/@deepseek-ai/dsh-session-log-export');
}

const directory = officialDirectory();

async function official() {
  return import(pathToFileURL(join(directory, 'lib/index.js')).href);
}

test('官方导出依赖的模块导出仍然存在且签名未变', async () => {
  const mod = await official();
  assert.equal(typeof mod.sessionLogExportDeps, 'function');
  assert.equal(typeof mod.sessionLogZipEntries, 'function');
  assert.equal(typeof mod.readSessionLogText, 'function');
  assert.equal(typeof mod.sessionLogZipFilename, 'function');
  assert.equal(mod.sessionLogExportDeps.length, 1);
  assert.equal(mod.sessionLogZipEntries.length, 5);
  assert.equal(mod.readSessionLogText.length, 3);
});

test('官方导出路由常量未变', async () => {
  const mod = await official();
  assert.equal(mod.SESSION_LOG_EXPORT_PATH, '/api/session.export');
});

test('官方“…”仍注册在同一个会话头部槽位（我们的按钮按 order 排在它左侧）', () => {
  const client = readFileSync(join(directory, 'lib/client.js'), 'utf8');
  assert.match(client, /conversation\.session\.header\.utilities/);
  assert.match(client, /id: "session-log-download"/);
  // 官方菜单与下载弹窗继续由官方占位者拥有；我们的按钮只是同槽里的另一个占位者。
  assert.match(client, /provide\("sessionLogDownload"/);
});

test('官方包版本与产品锁定的 DSH 版本一致', () => {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const upstream = JSON.parse(readFileSync(join(REPO, 'upstream.json'), 'utf8'));
  assert.equal(manifest.version, upstream.version);
});
