import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { SkillManager } from '../dist/services/manager.js';
import { clientBuiltinSlugs } from '../dist/market.js';

const DOC = '---\nname: %NAME%\ndescription: demo\n---\n';

/** 临时载体：用户技能目录里放一份会被名单命中的旧副本，以及一份用户自建技能。 */
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-client-builtin-reconcile-'));
  const agentsHome = join(root, 'agents');
  const ctx = new Context();
  ctx.skills = { get: async () => undefined, list: async () => [] };
  const manager = new SkillManager(ctx, { dshHome: join(root, 'dsh'), agentsHome });
  const legacy = join(agentsHome, 'skills', 'office-pptx');
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, 'SKILL.md'), DOC.replace('%NAME%', 'office-pptx'));
  const custom = join(agentsHome, 'skills', 'my-own');
  await mkdir(custom, { recursive: true });
  await writeFile(join(custom, 'SKILL.md'), DOC.replace('%NAME%', 'my-own'));
  process.env.WORKDSH_APP_VERSION = '1.0.6';
  return { manager, agentsHome, legacy, custom, root };
}

test('按市场客户端内置名单清理遮蔽随包副本的旧技能，保留用户自建技能', async () => {
  const { manager, agentsHome, legacy, custom, root } = await setup();
  try {
    assert.equal(await manager.clientBuiltinReconcilePending(), true);
    const result = await manager.reconcileClientBuiltinSkills(new Set(['office-pptx', 'workdsh-ppt-design']));
    assert.equal(result.removed, 1);
    await assert.rejects(stat(legacy));
    assert.equal((await stat(custom)).isDirectory(), true);
    // 同一载体版本再次启动不重复对账。
    assert.equal(await manager.clientBuiltinReconcilePending(), false);
    assert.deepEqual(await manager.reconcileClientBuiltinSkills(new Set(['office-pptx'])), { scanned: 0, removed: 0 });
    // 新版本再次启动时重新对账。
    process.env.WORKDSH_APP_VERSION = '1.0.7';
    assert.equal(await manager.clientBuiltinReconcilePending(), true);
  } finally {
    delete process.env.WORKDSH_APP_VERSION;
    await rm(root, { recursive: true, force: true });
  }
});

test('Web 没有载体版本：不做对账也不写标记', async () => {
  const { manager, legacy, root } = await setup();
  try {
    delete process.env.WORKDSH_APP_VERSION;
    assert.equal(await manager.clientBuiltinReconcilePending(), false);
    assert.deepEqual(await manager.reconcileClientBuiltinSkills(new Set(['office-pptx'])), { scanned: 0, removed: 0 });
    assert.equal((await stat(legacy)).isDirectory(), true);
  } finally {
    delete process.env.WORKDSH_APP_VERSION;
    await rm(root, { recursive: true, force: true });
  }
});

test('市场授权索引只取 is_client_builtin=1 的技能标识', () => {
  const names = clientBuiltinSlugs([
    { id: '1', slug: 'office-pptx', title: 'PPT', sceneLabels: [], clientBuiltin: true },
    { id: '2', slug: 'workdsh-ppt-design', title: '设计', sceneLabels: [], clientBuiltin: true },
    { id: '3', slug: 'market-only', title: '市场技能', sceneLabels: [], clientBuiltin: false },
    { id: '4', slug: 'unknown-flag', title: '未知', sceneLabels: [] },
  ]);
  assert.deepEqual([...names].sort(), ['office-pptx', 'workdsh-ppt-design']);
});

test('对账标记写入载体版本', async () => {
  const { manager, agentsHome, root } = await setup();
  try {
    await manager.reconcileClientBuiltinSkills(new Set(['office-pptx']));
    const marker = JSON.parse(await readFile(join(agentsHome, '.workdsh-state', 'skills', 'client-builtin-reconcile.json'), 'utf8'));
    assert.equal(marker.version, '1.0.6');
  } finally {
    delete process.env.WORKDSH_APP_VERSION;
    await rm(root, { recursive: true, force: true });
  }
});
