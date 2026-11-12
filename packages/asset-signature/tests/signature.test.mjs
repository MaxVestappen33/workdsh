import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import {
  ASSET_SIGNATURE_FRESHNESS_MS,
  ASSET_SIGNATURE_PUBLIC_KEYS,
  ASSET_SIGNATURE_REASONS,
  AssetSignatureError,
  canonicalAssetSignaturePayload,
  canonicalAssetSignatureFiles,
  compareAssetPaths,
  normalizeAssetPath,
  parseAssetSignatureCache,
  parseAssetSignatureEnvelope,
  sha256Hex,
  verifyAssetSignature,
} from '../dist/index.js';

const sha256 = value => sha256Hex(Buffer.from(value, 'utf8'));

const FILES = [
  { path: 'SKILL.md', size: 3, sha256: sha256('abc') },
  { path: 'scripts/run.md', size: 2, sha256: sha256('hi') },
];

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  return { spki, pem, privateKey };
}

function envelopeFor(files, privateKey, overrides = {}) {
  const payload = canonicalAssetSignaturePayload({ assetType: 'skill', assetId: '1857', files });
  return {
    assetType: 'skill',
    assetId: '1857',
    payloadVersion: 'workdsh-asset-signature-v1',
    algo: 'Ed25519',
    keyId: 'test-key',
    digest: sha256Hex(payload),
    signature: sign(null, payload, privateKey).toString('base64'),
    fileCount: files.length,
    files,
    signedAt: '2026-11-09 10:00:00',
    ...overrides,
  };
}

test('自检金标准：载荷 231 字节、sha256=981a5d…fbe2、字节序下 SKILL.md 在前', () => {
  const payload = canonicalAssetSignaturePayload({ assetType: 'skill', assetId: '1857', files: FILES });
  assert.equal(payload.byteLength, 231);
  assert.equal(
    payload.toString('utf8'),
    'workdsh-asset-signature-v1\n'
    + 'assetType:skill\n'
    + 'assetId:1857\n'
    + 'fileCount:2\n'
    + '8:SKILL.md:3:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\n'
    + '14:scripts/run.md:2:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4\n',
  );
  assert.equal(sha256Hex(payload), '981a5d0159bc60df0c8c5d55427198d7d4a35c23395c62572de8f53e4b5afbe2');
  assert.ok(compareAssetPaths('SKILL.md', 'scripts/run.md') < 0);
  assert.ok('resources/note.txt'.localeCompare('SKILL.md') < 0, 'localeCompare 的顺序与字节序相反，必须不能再用它');
});

test('路径规范化：NFC、禁用字符、空层级、层级与字节上限', () => {
  assert.equal(normalizeAssetPath('skills/e\u0301t\u00e9.md'), 'skills/été.md');
  for (const bad of ['', 'a\\b', 'a:b', 'a\u0000b', 'a\u001fb', '/abs', 'a//b', 'a/./b', 'a/../b', 'a/']) {
    assert.throws(() => normalizeAssetPath(bad), AssetSignatureError, `应拒绝：${JSON.stringify(bad)}`);
  }
  assert.throws(() => normalizeAssetPath(`${'a'.repeat(513)}`), error => error instanceof AssetSignatureError && /512 字节/.test(error.detail));
  assert.throws(() => normalizeAssetPath('a/b/c/d/e/f/g/h/i'), error => error instanceof AssetSignatureError && /层级超过 8/.test(error.detail));
  const duplicated = [...FILES, { ...FILES[0] }];
  assert.throws(() => canonicalAssetSignatureFiles(duplicated), error => error instanceof AssetSignatureError && /重复/.test(error.detail));
  assert.throws(() => canonicalAssetSignatureFiles([{ path: 'a.md', size: 1, sha256: 'ABC' }]), error => error instanceof AssetSignatureError && /摘要无效/.test(error.detail));
});

test('临时密钥对自签自验通过，PEM 与 base64 DER 两种公钥写法都支持', () => {
  const { spki, pem, privateKey } = keyPair();
  const envelope = envelopeFor(FILES, privateKey);
  for (const key of [spki, pem]) {
    const verdict = verifyAssetSignature({
      envelope, expectedAssetType: 'skill', expectedAssetId: '1857', files: FILES, publicKeys: { 'test-key': key },
    });
    assert.deepEqual(verdict, { ok: true });
  }
});

test('公钥表缺失 keyId：fail closed，不给「无签名可放行」', () => {
  const { privateKey } = keyPair();
  const missingKeyId = 'no-such-key-2099';
  assert.equal(ASSET_SIGNATURE_PUBLIC_KEYS[missingKeyId], undefined);
  const verdict = verifyAssetSignature({
    envelope: envelopeFor(FILES, privateKey, { keyId: missingKeyId }), expectedAssetType: 'skill', expectedAssetId: '1857', files: FILES,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, ASSET_SIGNATURE_REASONS.missing);
  assert.match(verdict.detail, /keyId=no-such-key-2099/);
});

test('内置公钥表包含 2026a，且可解析为 Ed25519', () => {
  const value = ASSET_SIGNATURE_PUBLIC_KEYS['2026a'];
  assert.ok(value, '缺少 2026a 公钥');
  const key = createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
  assert.equal(key.asymmetricKeyType, 'ed25519');
});

test('文件集合/逐文件大小/摘要不一致时拒绝，多出文件单独归类', () => {
  const { spki, privateKey } = keyPair();
  const envelope = envelopeFor(FILES, privateKey);
  const verify = files => verifyAssetSignature({
    envelope, expectedAssetType: 'skill', expectedAssetId: '1857', files, publicKeys: { 'test-key': spki },
  });
  assert.equal(verify([FILES[0]]).reason, 'manifest-mismatch');
  assert.equal(verify([FILES[0], { ...FILES[1], size: 3 }]).code, ASSET_SIGNATURE_REASONS.manifestMismatch);
  assert.equal(verify([FILES[0], { ...FILES[1], sha256: sha256('ho') }]).reason, 'manifest-mismatch');
  const extra = verify([...FILES, { path: 'evil.md', size: 1, sha256: sha256('x') }]);
  assert.equal(extra.reason, 'manifest-extra-file');
  assert.equal(extra.code, ASSET_SIGNATURE_REASONS.manifestExtraFile);
});

test('envelope 的资产类型/编号与安装位置不一致时拒绝（防签名搬用）', () => {
  const { spki, privateKey } = keyPair();
  const envelope = envelopeFor(FILES, privateKey);
  const base = { envelope, files: FILES, publicKeys: { 'test-key': spki } };
  assert.equal(verifyAssetSignature({ ...base, expectedAssetType: 'skill', expectedAssetId: '9999' }).code, ASSET_SIGNATURE_REASONS.assetMismatch);
  assert.equal(verifyAssetSignature({ ...base, expectedAssetType: 'mcp', expectedAssetId: '1857' }).code, ASSET_SIGNATURE_REASONS.assetMismatch);
});

test('digest 被改、签名被改、fileCount 不符、算法不符都按签名无效拒绝', () => {
  const { spki, privateKey } = keyPair();
  const envelope = envelopeFor(FILES, privateKey);
  const verify = overrides => verifyAssetSignature({
    envelope: { ...envelope, ...overrides }, expectedAssetType: 'skill', expectedAssetId: '1857',
    files: FILES, publicKeys: { 'test-key': spki },
  });
  assert.equal(verify({ digest: sha256('other') }).code, ASSET_SIGNATURE_REASONS.invalid);
  assert.equal(verify({ signature: Buffer.alloc(64).toString('base64') }).code, ASSET_SIGNATURE_REASONS.invalid);
  assert.equal(verify({ fileCount: 3 }).code, ASSET_SIGNATURE_REASONS.invalid);
  assert.equal(verify({ algo: 'RSA' }).code, ASSET_SIGNATURE_REASONS.invalid);
  assert.equal(verify({ payloadVersion: 'v0' }).code, ASSET_SIGNATURE_REASONS.invalid);
});

test('离线缓存超过 24 小时拒绝，窗口内可用', () => {
  const { spki, privateKey } = keyPair();
  const envelope = envelopeFor(FILES, privateKey);
  const now = Date.now();
  const verify = fetchedAt => verifyAssetSignature({
    envelope, expectedAssetType: 'skill', expectedAssetId: '1857', files: FILES,
    publicKeys: { 'test-key': spki }, fetchedAt, now,
  });
  assert.deepEqual(verify(now - 60_000), { ok: true });
  const expired = verify(now - ASSET_SIGNATURE_FRESHNESS_MS - 1);
  assert.equal(expired.code, ASSET_SIGNATURE_REASONS.missing);
  assert.match(expired.detail, /24 小时/);
});

test('签名响应解析：数字 assetId 可接受，缺字段/坏摘要/坏签名拒绝', () => {
  const { privateKey } = keyPair();
  const envelope = envelopeFor(FILES, privateKey);
  assert.equal(parseAssetSignatureEnvelope({ ...envelope, assetId: 1857 }).assetId, '1857');
  const broken = [
    { ...envelope, assetType: undefined },
    { ...envelope, digest: 'zz' },
    { ...envelope, signature: Buffer.alloc(32).toString('base64') },
    { ...envelope, fileCount: -1 },
    { ...envelope, files: [{ path: 'a.md', size: '1', sha256: sha256('a') }] },
  ];
  for (const value of broken) assert.throws(() => parseAssetSignatureEnvelope(value), AssetSignatureError);
  assert.ok(parseAssetSignatureEnvelope({ ...envelope, signedAt: 1_793_024_260_189 }).signedAt);
});

test('本地缓存解析：字符串时间与毫秒时间都接受，损坏返回 undefined', () => {
  const { privateKey } = keyPair();
  const envelope = envelopeFor(FILES, privateKey);
  assert.equal(parseAssetSignatureCache({ fetchedAt: '2026-11-09T00:00:00.000Z', envelope }).fetchedAt, Date.parse('2026-11-09T00:00:00.000Z'));
  assert.equal(parseAssetSignatureCache({ fetchedAt: 1, envelope }).fetchedAt, 1);
  assert.equal(parseAssetSignatureCache({ fetchedAt: 'nope', envelope }), undefined);
  assert.equal(parseAssetSignatureCache({ fetchedAt: 1, envelope: { ...envelope, digest: 'bad' } }), undefined);
  assert.equal(parseAssetSignatureCache(null), undefined);
});
