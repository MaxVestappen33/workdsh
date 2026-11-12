import assert from 'node:assert/strict';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeBundledSkillManifests } from '../../../../scripts/write-bundled-skill-manifests.mjs';

const DOC = '---\nname: demo\ndescription: demo\n---\n';
const PAYLOAD_VERSION = 'workdsh-asset-signature-v1';

function canonicalFiles(files) {
  return [...files]
    .map(file => ({ path: file.path, size: file.size, sha256: file.sha256 }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')));
}

function payloadOf(assetId, files) {
  const rows = canonicalFiles(files);
  const lines = [
    PAYLOAD_VERSION,
    'assetType:skill',
    `assetId:${assetId}`,
    `fileCount:${rows.length}`,
    ...rows.map(file => `${Buffer.byteLength(file.path, 'utf8')}:${file.path}:${file.size}:${file.sha256}`),
  ];
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

/** 造一个最小技能目录，并生成与之一致的签名导出文件。 */
async function setup(options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'workdsh-builtin-signature-'));
  const root = join(home, 'skills');
  const signaturesDir = join(home, 'signatures');
  const skillDir = join(root, 'demo');
  await mkdir(skillDir, { recursive: true });
  await mkdir(signaturesDir, { recursive: true });
  const content = options.content ?? DOC;
  await writeFile(join(skillDir, 'SKILL.md'), content);
  const files = [{
    path: 'SKILL.md',
    size: Buffer.byteLength(content),
    sha256: createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex'),
  }];
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const assetId = options.assetId ?? '1857';
  const payload = payloadOf(assetId, files);
  const envelope = {
    assetType: 'skill',
    assetId,
    payloadVersion: PAYLOAD_VERSION,
    algo: 'Ed25519',
    keyId: 'test',
    digest: createHash('sha256').update(payload).digest('hex'),
    signature: sign(null, payload, createPrivateKey(privateKey.export({ type: 'pkcs8', format: 'pem' }))).toString('base64'),
    fileCount: files.length,
    files,
    signedAt: '2026-11-10 10:00:00',
    ...options.envelope,
  };
  if (options.export !== false) await writeFile(join(signaturesDir, 'demo.json'), JSON.stringify(envelope, null, 2));
  const publicKeys = { test: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  return { root, signaturesDir, skillDir, envelope, publicKeys };
}

const manifestOf = async skillDir => JSON.parse(await readFile(join(skillDir, '.workdsh-install.json'), 'utf8'));

test('导出签名有效：清单写入 assetId 与签名块', async () => {
  const { root, signaturesDir, skillDir, envelope, publicKeys } = await setup();
  const [result] = await writeBundledSkillManifests([root], { signaturesDir, mode: 'strict', publicKeys });
  assert.equal(result.skills, 1);
  assert.equal(result.written, 1);
  const manifest = await manifestOf(skillDir);
  assert.equal(manifest.source, 'builtin');
  assert.equal(manifest.assetId, envelope.assetId);
  assert.equal(manifest.signature.payloadVersion, envelope.payloadVersion);
  assert.equal(manifest.signature.keyId, 'test');
  assert.equal(manifest.signature.digest, envelope.digest);
  assert.equal(manifest.signature.signature, envelope.signature);
});

test('本地文件哈希与导出文件不一致：strict 中断并指出文件名', async () => {
  const { root, signaturesDir, skillDir, publicKeys } = await setup();
  await writeFile(join(skillDir, 'SKILL.md'), DOC.replace('description: demo', 'description: evi1'));
  await assert.rejects(
    writeBundledSkillManifests([root], { signaturesDir, mode: 'strict', publicKeys }),
    /内置技能签名校验失败：demo：文件摘要不一致：SKILL\.md/u,
  );
});

test('导出文件摘要被改：strict 中断，指出载荷摘要不一致', async () => {
  const { root, signaturesDir, skillDir, envelope, publicKeys } = await setup({ envelope: { digest: 'c'.repeat(64) } });
  await assert.rejects(
    writeBundledSkillManifests([root], { signaturesDir, mode: 'strict', publicKeys }),
    /内置技能签名校验失败：demo：载荷摘要不一致/u,
  );
  await assert.rejects(readFile(join(skillDir, '.workdsh-install.json'), 'utf8'), /ENOENT/u);
  assert.equal(envelope.digest, 'c'.repeat(64));
});

test('缺少导出文件：strict 中断，warn 降级为未签名清单', async () => {
  const strict = await setup({ export: false });
  await assert.rejects(
    writeBundledSkillManifests([strict.root], { signaturesDir: strict.signaturesDir, mode: 'strict', publicKeys: strict.publicKeys }),
    /内置技能缺少签名导出：demo/u,
  );

  const warn = await setup({ export: false });
  const [result] = await writeBundledSkillManifests([warn.root], { signaturesDir: warn.signaturesDir, mode: 'warn', publicKeys: warn.publicKeys });
  assert.equal(result.written, 1);
  const manifest = await manifestOf(warn.skillDir);
  assert.equal(manifest.signature, undefined);
  assert.equal(manifest.assetId, undefined);
  assert.equal(manifest.files.length, 1);
});
