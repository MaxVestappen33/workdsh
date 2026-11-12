import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  ASSET_MANIFEST_FILE, ASSET_SIGNATURE_CACHE_FILE, assetFileManifestPath, assetManifestPath, assetSignatureCachePath,
  readAssetFileManifest, readAssetManifest, verifyAssetFileManifest, verifyAssetManifest,
  writeAssetFileManifest, writeAssetManifest,
} from '../dist/index.js';

const roots = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'asset-manifest-'));
  roots.push(root);
  await mkdir(join(root, 'resources'), { recursive: true });
  await writeFile(join(root, 'SKILL.md'), '---\nname: demo\ndescription: demo\n---\n');
  await writeFile(join(root, 'resources', 'note.txt'), 'hello');
  return root;
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('写入后能读回同一份清单，且清单自身不计入文件列表', async () => {
  const root = await fixture();
  const written = await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'market', assetId: '1001' });
  assert.equal(written.assetType, 'skill');
  assert.equal(written.assetId, '1001');
  assert.deepEqual(written.files.map(file => file.path), ['SKILL.md', 'resources/note.txt']);
  const read = await readAssetManifest(root);
  assert.deepEqual(read, written);
  const text = await readFile(assetManifestPath(root), 'utf8');
  assert.ok(text.includes('"schema": 2'));
});

test('没有清单时按「无清单」处理，不抛错', async () => {
  const root = await fixture();
  assert.equal(await readAssetManifest(root), undefined);
  assert.deepEqual(await verifyAssetManifest(root), { ok: false, reason: 'missing', checked: 'quick' });
});

test('内容损坏的清单同样按「无清单」处理', async () => {
  const root = await fixture();
  await writeFile(join(root, ASSET_MANIFEST_FILE), '{ not json');
  assert.equal(await readAssetManifest(root), undefined);
});

test('结构不认识（版本不同）的清单按「无清单」处理', async () => {
  const root = await fixture();
  await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'local' });
  const value = JSON.parse(await readFile(assetManifestPath(root), 'utf8'));
  await writeFile(assetManifestPath(root), JSON.stringify({ ...value, schema: 3 }));
  assert.equal(await readAssetManifest(root), undefined);
});

test('schema 1 旧清单可读但按「无签名」处理，签名块不被采纳', async () => {
  const root = await fixture();
  await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'market', assetId: '1001' });
  const value = JSON.parse(await readFile(assetManifestPath(root), 'utf8'));
  await writeFile(assetManifestPath(root), JSON.stringify({
    ...value,
    schema: 1,
    signature: { payloadVersion: 'workdsh-asset-signature-v1', algo: 'Ed25519', keyId: '2026a', digest: 'a'.repeat(64), signature: 'b'.repeat(88) },
  }));
  const read = await readAssetManifest(root);
  assert.equal(read.schema, 1);
  assert.equal(read.signature, undefined);
});

test('未改动时校验通过', async () => {
  const root = await fixture();
  await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'builtin' });
  assert.deepEqual(await verifyAssetManifest(root), { ok: true, checked: 'sha256' });
});

test('新增文件后摘要变化，校验失败', async () => {
  const root = await fixture();
  await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'builtin' });
  await writeFile(join(root, 'resources', 'extra.txt'), 'x');
  assert.deepEqual(await verifyAssetManifest(root), { ok: false, reason: 'digest-mismatch', checked: 'sha256' });
});

test('删除文件时先在小代价比对上失败', async () => {
  const root = await fixture();
  await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'local' });
  await rm(join(root, 'resources', 'note.txt'));
  assert.deepEqual(await verifyAssetManifest(root), { ok: false, reason: 'file-missing', checked: 'quick' });
});

test('大小被改时快速比对即失败，不做 sha256', async () => {
  const root = await fixture();
  await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'local' });
  await writeFile(join(root, 'resources', 'note.txt'), 'hello world');
  assert.deepEqual(await verifyAssetManifest(root), { ok: false, reason: 'quick-mismatch', checked: 'quick' });
});

test('大小与修改时间不变但内容被换掉时，由 sha256 摘要发现', async () => {
  const root = await fixture();
  const before = await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'local' });
  const entry = before.files.find(file => file.path === 'resources/note.txt');
  await writeFile(join(root, 'resources', 'note.txt'), 'jello');
  await utimes(join(root, 'resources', 'note.txt'), entry.mtimeMs / 1000, entry.mtimeMs / 1000);
  assert.deepEqual(await verifyAssetManifest(root), { ok: false, reason: 'digest-mismatch', checked: 'sha256' });
});

test('单文件资产：旁挂清单文件名带原文件名，校验通过', async () => {
  const root = await fixture();
  const file = join(root, 'demo.md');
  await writeFile(file, '---\nname: demo\ndescription: demo\n---\n');
  const written = await writeAssetFileManifest(file, { assetType: 'skill', name: 'demo', source: 'market', assetId: '42' });
  assert.equal(assetFileManifestPath(file), join(root, '.demo.md.workdsh-install.json'));
  assert.deepEqual(written.files.map(entry => entry.path), ['demo.md']);
  assert.equal((await readAssetFileManifest(file)).assetId, '42');
  assert.deepEqual(await verifyAssetFileManifest(file), { ok: true, checked: 'sha256' });
});

test('单文件资产改名后对不上旁挂清单，按无清单处理', async () => {
  const root = await fixture();
  const file = join(root, 'demo.md');
  await writeFile(file, '---\nname: demo\ndescription: demo\n---\n');
  await writeAssetFileManifest(file, { assetType: 'skill', name: 'demo', source: 'local' });
  const renamed = join(root, 'other.md');
  await rename(file, renamed);
  assert.equal(await readAssetFileManifest(renamed), undefined);
  assert.deepEqual(await verifyAssetFileManifest(renamed), { ok: false, reason: 'missing', checked: 'quick' });
});

test('单文件资产内容变化时校验失败', async () => {
  const root = await fixture();
  const file = join(root, 'demo.md');
  await writeFile(file, '---\nname: demo\ndescription: demo\n---\n');
  await writeAssetFileManifest(file, { assetType: 'skill', name: 'demo', source: 'local' });
  await writeFile(file, '---\nname: demo\ndescription: changed\n---\n');
  assert.equal((await verifyAssetFileManifest(file)).ok, false);
});

const SIGNATURE = {
  payloadVersion: 'workdsh-asset-signature-v1', algo: 'Ed25519', keyId: '2026a',
  digest: 'a'.repeat(64), signature: 'b'.repeat(88),
};

test('schema 2 清单保留签名块，签名缓存文件不计入文件清单与摘要', async () => {
  const root = await fixture();
  const written = await writeAssetManifest(root, {
    assetType: 'skill', name: 'demo', source: 'market', assetId: '1001', signature: SIGNATURE,
  });
  assert.deepEqual(written.signature, SIGNATURE);
  assert.ok(!written.files.some(file => file.path === ASSET_SIGNATURE_CACHE_FILE));
  await writeFile(assetSignatureCachePath(root), '{"fetchedAt":1}');
  assert.deepEqual(await verifyAssetManifest(root), { ok: true, checked: 'sha256' });
  assert.deepEqual((await readAssetManifest(root)).signature, SIGNATURE);
});

test('签名资产不再用 mtime 短路：只改 mtime 不判篡改，同尺寸换内容仍由 sha256 发现', async () => {
  const root = await fixture();
  const before = await writeAssetManifest(root, {
    assetType: 'skill', name: 'demo', source: 'market', assetId: '1001', signature: SIGNATURE,
  });
  const later = Date.now() / 1000 + 120;
  await utimes(join(root, 'SKILL.md'), later, later);
  assert.deepEqual(await verifyAssetManifest(root), { ok: true, checked: 'sha256' });

  const entry = before.files.find(file => file.path === 'SKILL.md');
  // 与原文同尺寸（demo → evi1），并把 mtime 恢复成清单记录的时间，模拟「保留时间戳」的篡改。
  await writeFile(join(root, 'SKILL.md'), '---\nname: demo\ndescription: evi1\n---\n');
  await utimes(join(root, 'SKILL.md'), entry.mtimeMs / 1000, entry.mtimeMs / 1000);
  assert.deepEqual(await verifyAssetManifest(root), { ok: false, reason: 'digest-mismatch', checked: 'sha256' });
});

test('未签名资产仍保留 mtime 快速判篡改', async () => {
  const root = await fixture();
  await writeAssetManifest(root, { assetType: 'skill', name: 'demo', source: 'local' });
  const later = Date.now() / 1000 + 120;
  await utimes(join(root, 'SKILL.md'), later, later);
  assert.deepEqual(await verifyAssetManifest(root), { ok: false, reason: 'quick-mismatch', checked: 'quick' });
});
