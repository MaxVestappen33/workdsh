import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { assetManifestPath, assetSignatureCachePath, writeAssetManifest } from 'workdsh-asset-manifest';
import { ASSET_SIGNATURE_REASONS, canonicalAssetSignaturePayload, sha256Hex } from 'workdsh-asset-signature';
import { SIGNATURE_REINSTALL_MESSAGE, writeSignatureCache } from '../dist/services/asset-signatures.js';
import { signatureIntegrityCode } from '../dist/services/connection-api.js';
import { SkillManager } from '../dist/services/manager.js';
import { SkillMarketService } from '../dist/services/market-entry.js';

const DOC = '---\nname: demo\ndescription: demo\n---\n';

/** 最小可用的 SkillManager：技能目录在临时 HOME 下，ctx.skills 只返回空。 */
async function setup(options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-skill-signature-'));
  const ctx = new Context();
  ctx.skills = { get: async () => undefined, list: async () => [] };
  const agentsHome = join(home, 'agents');
  const manager = new SkillManager(ctx, { dshHome: join(home, 'dsh'), agentsHome });
  const dir = join(agentsHome, 'skills', 'demo');
  await mkdir(dir, { recursive: true });
  const content = options.content ?? DOC;
  await writeFile(join(dir, 'SKILL.md'), content);
  const files = options.files ?? [{ path: 'SKILL.md', size: Buffer.byteLength(content), sha256: sha256Hex(Buffer.from(content, 'utf8')) }];
  const assetId = options.assetId ?? '1857';
  const envelope = {
    assetType: 'skill', assetId: options.envelopeAssetId ?? assetId,
    payloadVersion: 'workdsh-asset-signature-v1', algo: 'Ed25519', keyId: '2026a',
    digest: sha256Hex(canonicalAssetSignaturePayload({ assetType: 'skill', assetId: options.envelopeAssetId ?? assetId, files })),
    // 不构造真实签名：这里只覆盖缓存、结构、身份与文件集合类失败；
    // 验签成功的路径由 asset-signature 包用临时密钥对覆盖。
    signature: Buffer.alloc(64).toString('base64'), fileCount: files.length, files,
    signedAt: '2026-11-09 10:00:00',
  };
  if (options.manifest !== false) {
    await writeAssetManifest(dir, {
      assetType: 'skill', name: 'demo', source: options.source ?? 'market', ...(options.source === 'local' ? {} : { assetId }),
      ...(options.signed === false ? {} : { signature: {
        payloadVersion: envelope.payloadVersion, algo: envelope.algo, keyId: envelope.keyId,
        digest: envelope.digest, signature: envelope.signature,
      } }),
    });
  }
  if (options.cache !== false) await writeSignatureCache(assetSignatureCachePath(dir), envelope, options.fetchedAt ?? Date.now());
  return { manager, dir, envelope };
}

test('签名资产的缓存缺失或超过 24 小时：按签名缺失拒绝', async () => {
  const missing = await setup({ cache: false });
  assert.deepEqual(await missing.manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'signature-missing' });

  const expired = await setup({ fetchedAt: Date.now() - 25 * 60 * 60 * 1000 });
  assert.deepEqual(await expired.manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'signature-missing' });
});

test('市场清单没有签名块（schema 1 口径）按签名缺失拒绝', async () => {
  const { manager } = await setup({ signed: false, cache: false });
  assert.deepEqual(await manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'signature-missing' });
});

test('本地自建清单不带签名：仍走本地快速校验并通过', async () => {
  const { manager } = await setup({ source: 'local', signed: false, cache: false });
  assert.deepEqual(await manager.verifyInstalledIntegrity('demo'), { ok: true });
});

test('文件集合之外多出文件：manifest-extra-file', async () => {
  const { manager, dir } = await setup();
  await writeFile(join(dir, 'evil.md'), 'x');
  assert.deepEqual(await manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'manifest-extra-file' });
});

test('同尺寸换内容：签名资产以哈希为准，manifest-mismatch', async () => {
  const { manager, dir } = await setup();
  await writeFile(join(dir, 'SKILL.md'), DOC.replace('description: demo', 'description: evi1'));
  assert.deepEqual(await manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'manifest-mismatch' });
});

test('清单签名块与缓存 envelope 不一致：signature-invalid', async () => {
  const { manager, dir } = await setup();
  const target = assetManifestPath(dir);
  const value = JSON.parse(await readFile(target, 'utf8'));
  value.signature.digest = 'c'.repeat(64);
  await writeFile(target, JSON.stringify(value));
  assert.deepEqual(await manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'signature-invalid' });
});

test('缓存 envelope 的资产编号与安装清单不一致：signature-asset-mismatch（防签名搬用）', async () => {
  const { manager } = await setup({ envelopeAssetId: '9999' });
  assert.deepEqual(await manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'signature-asset-mismatch' });
});

test('验签开关关闭：市场清单没有签名块也放行，但内容比对照常执行', async () => {
  const clean = await setup({ signed: false, cache: false });
  assert.deepEqual(await clean.manager.verifyInstalledIntegrity('demo', { signature: false }), { ok: true });

  const tampered = await setup({ signed: false, cache: false });
  // 未签名资产先比大小与 mtime：这里把 mtime 还原成清单记录值，确保走到摘要比对，
  // 否则同一毫秒内重写文件会让快速校验先命中，结论随机器快慢漂移。
  const originalMtime = (await stat(join(tampered.dir, 'SKILL.md'))).mtime;
  await writeFile(join(tampered.dir, 'evil.md'), 'x');
  await utimes(join(tampered.dir, 'SKILL.md'), originalMtime, originalMtime);
  assert.deepEqual(await tampered.manager.verifyInstalledIntegrity('demo', { signature: false }), { ok: false, reason: 'digest-mismatch' });

  // 签名资产在开关关闭时也验签（签名块存在即验），文件改动按 manifest-mismatch 拒绝。
  const signed = await setup();
  await writeFile(join(signed.dir, 'SKILL.md'), DOC.replace('description: demo', 'description: evi1'));
  assert.deepEqual(await signed.manager.verifyInstalledIntegrity('demo', { signature: false }), { ok: false, reason: 'manifest-mismatch' });
});

test('验签开关开启：无签名块按 gate/denied-signature-missing 拒绝并提示重新安装', async () => {
  const { manager } = await setup({ signed: false, cache: false });
  assert.deepEqual(await manager.verifyInstalledIntegrity('demo', { signature: true }), { ok: false, reason: 'signature-missing' });
  assert.equal(signatureIntegrityCode('signature-missing'), ASSET_SIGNATURE_REASONS.missing);
  assert.equal(ASSET_SIGNATURE_REASONS.missing, 'gate/denied-signature-missing');
  assert.match(SIGNATURE_REINSTALL_MESSAGE, /重新安装/u);
});

test('验签开关关闭：市场安装不取签名，清单不写签名块', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-market-install-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const installedDir = join(home, 'installed', 'demo');
  await mkdir(installedDir, { recursive: true });
  await writeFile(join(installedDir, 'SKILL.md'), DOC);
  const requested = [];
  const ctx = new Context();
  ctx.provide('workdshBackend', {
    async available() { return true; },
    async get(path) {
      requested.push(path);
      if (path.endsWith('queryAuthorizedSkillList')) {
        return {
          records: [{ id: '1857', skillName: '演示', skillNameEn: 'demo', fjxxList: [{ fileName: 'demo.md', filePath: 'http://files.test/demo.md' }] }],
          total: 1,
        };
      }
      throw new Error(`unexpected request: ${path}`);
    },
    async post() { return {}; },
  });
  // 开关关闭（含主闸门关闭）：signatureEnabled() 为 false。
  ctx.provide('workdshAssetGate', { enabled: () => false, signatureEnabled: () => false });
  ctx.workdshSkills = {
    list: async () => [],
    imports: {
      async stage() { return { id: 'staged', inspection: { name: 'demo' } }; },
      async discard() {},
      async commit() { return { path: installedDir }; },
    },
  };
  t.mock.method(globalThis, 'fetch', async () => new Response(DOC, { status: 200 }));
  try {
    await ctx.plugin(SkillMarketService, { paths: { signature: '/desktop-client/asset/queryAssetSignature' } });
    await ctx.workdshSkillMarket.list();
    assert.deepEqual(await ctx.workdshSkillMarket.install('1857'), { name: 'demo', state: 'installed' });
    assert.equal(requested.some(path => path.endsWith('queryAssetSignature')), false);
    const manifest = JSON.parse(await readFile(assetManifestPath(installedDir), 'utf8'));
    assert.equal(manifest.schema, 2);
    assert.equal(manifest.source, 'market');
    assert.equal(manifest.assetId, '1857');
    assert.equal(manifest.signature, undefined);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await ctx.fiber.dispose();
  }
});

test('内置清单带签名块但验签不过：source=builtin 也必须拒绝，开关关闭同样验', async () => {
  const builtin = await setup({ source: 'builtin', cache: false });
  assert.deepEqual(await builtin.manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'signature-invalid' });
  assert.deepEqual(await builtin.manager.verifyInstalledIntegrity('demo', { signature: false }), { ok: false, reason: 'signature-invalid' });
  assert.equal(signatureIntegrityCode('signature-invalid'), ASSET_SIGNATURE_REASONS.invalid);
});

test('市场清单把 source 改成 builtin 并删掉缓存：仍按签名块验签拦住', async () => {
  const { manager, dir } = await setup();
  const target = assetManifestPath(dir);
  const value = JSON.parse(await readFile(target, 'utf8'));
  value.source = 'builtin';
  await writeFile(target, JSON.stringify(value));
  await rm(assetSignatureCachePath(dir), { force: true });
  assert.deepEqual(await manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'signature-invalid' });
});

test('内置清单没有签名块：内容比对照常执行，改内容仍拒绝', async () => {
  const clean = await setup({ source: 'builtin', signed: false, cache: false });
  assert.deepEqual(await clean.manager.verifyInstalledIntegrity('demo'), { ok: true });

  const tampered = await setup({ source: 'builtin', signed: false, cache: false });
  await writeFile(join(tampered.dir, 'SKILL.md'), DOC.replace('description: demo', 'description: evi1'));
  // 明确把 mtime 推后，保证快速校验先命中并返回 quick-mismatch，不再依赖两次写入是否同毫秒。
  const later = new Date(Date.now() + 5_000);
  await utimes(join(tampered.dir, 'SKILL.md'), later, later);
  assert.deepEqual(await tampered.manager.verifyInstalledIntegrity('demo'), { ok: false, reason: 'quick-mismatch' });
  assert.equal(signatureIntegrityCode('digest-mismatch'), ASSET_SIGNATURE_REASONS.manifestMismatch);
});
