#!/usr/bin/env node
/**
 * 构建期为随包内置技能写入安装清单（`source: 'builtin'`）。
 *
 * 用法：node scripts/write-bundled-skill-manifests.mjs [--signatures <dir>] [--mode strict|warn] <skillsRoot> [...]
 *
 * 每个含 SKILL.md 的直接子目录视为一个技能；重复执行不产生变化（内容一致时跳过）。
 * 清单格式与 `packages/asset-manifest` 的 `writeAssetManifest` 完全一致：
 * schema 2 + 文件清单（path/size/sha256/mtimeMs）+ 按路径 UTF-8 字节序排序的摘要。
 *
 * 签名：若 `<signatures>/<技能名>.json` 存在（从后台 `queryAssetSignature` 导出的 envelope），
 * 构建期做三重校验并在清单里写入 `assetId` 与签名块：
 *   1) 本地文件逐个比对 envelope.files 的 size/sha256；文件集合必须完全相等；
 *   2) 用 envelope.files 按签名载荷规范重建字节流，比 envelope.digest；
 *   3) 按 keyId 取内置公钥做 Ed25519 验签。
 * 任一不一致按 `mode` 处理：`strict`（默认）中断构建并指出技能与文件；`warn` 打醒目告警后
 * 不写签名块（保留内容摘要清单，运行时按「无签名内置资产」做内容比对）。
 * 过渡期用 `WORKDSH_BUILTIN_SIGNATURE_MODE=warn`，导出文件齐备后切回 strict。
 *
 * 这里刻意不 import `workdsh-asset-manifest` / `workdsh-asset-signature`：根目录不在该 pnpm
 * workspace 内，且构建顺序不保证其 dist 已生成；格式保持一致即可。内置公钥表按源码文本读取，
 * 避免出现第二份公钥常量。
 */
import { createHash, createPublicKey, verify as verifyEd25519 } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_FILE = '.workdsh-install.json';
const SIGNATURE_CACHE_FILE = '.workdsh-asset-signature.json';
const SCHEMA = 2;
const MAX_FILES = 1000;
const MAX_DEPTH = 8;
const MAX_PATH_BYTES = 512;
const PAYLOAD_VERSION = 'workdsh-asset-signature-v1';
const ALGO = 'Ed25519';
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SIGNATURE_MODES = new Set(['strict', 'warn']);

/** 与签名载荷一致：按 UTF-8 字节无符号升序，不能用 localeCompare。 */
function comparePaths(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function digestOfFiles(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => comparePaths(a.path, b.path))) {
    hash.update(file.path); hash.update('\0');
    hash.update(String(file.size)); hash.update('\0');
    hash.update(file.sha256); hash.update('\0');
  }
  return hash.digest('hex');
}

/** 与 `normalizeAssetPath` 同规则；构建期只校验，不做修正。 */
function normalizePath(raw) {
  if (typeof raw !== 'string' || !raw) throw new Error('文件路径为空');
  const path = raw.normalize('NFC');
  if (CONTROL_PATTERN.test(path)) throw new Error(`文件路径包含控制字符：${JSON.stringify(raw)}`);
  if (path.includes('\\')) throw new Error(`文件路径使用了反斜杠：${path}`);
  if (path.includes(':')) throw new Error(`文件路径包含冒号：${path}`);
  if (path.startsWith('/')) throw new Error(`文件路径不能是绝对路径：${path}`);
  const segments = path.split('/');
  if (segments.some(segment => segment === '')) throw new Error(`文件路径包含空层级：${path}`);
  if (segments.some(segment => segment === '.' || segment === '..')) throw new Error(`文件路径包含 . 或 ..：${path}`);
  if (segments.length > MAX_DEPTH) throw new Error(`文件路径层级超过 ${MAX_DEPTH}：${path}`);
  if (Buffer.byteLength(path, 'utf8') > MAX_PATH_BYTES) throw new Error(`文件路径超过 ${MAX_PATH_BYTES} 字节：${path}`);
  return path;
}

/** 与 `canonicalAssetSignatureFiles` 同规则：校验、去重、按字节序排序。 */
function canonicalSignatureFiles(files) {
  if (!Array.isArray(files)) throw new Error('文件列表不是数组');
  if (files.length > MAX_FILES) throw new Error(`文件数超过 ${MAX_FILES}：${files.length}`);
  const seen = new Set();
  const rows = files.map(file => {
    const path = normalizePath(file?.path);
    if (seen.has(path)) throw new Error(`文件路径重复：${path}`);
    seen.add(path);
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`文件大小无效：${path}`);
    if (typeof file.sha256 !== 'string' || !SHA256_PATTERN.test(file.sha256)) throw new Error(`文件摘要无效：${path}`);
    return { path, size: file.size, sha256: file.sha256 };
  });
  return rows.sort((left, right) => comparePaths(left.path, right.path));
}

function headerField(value, field) {
  if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error(`${field} 为空或包含首尾空白`);
  if (CONTROL_PATTERN.test(value)) throw new Error(`${field} 包含控制字符`);
  if (value.includes(':')) throw new Error(`${field} 包含冒号`);
  return value;
}

/** 与 `canonicalAssetSignaturePayload` 逐字节一致的载荷。 */
function signaturePayload({ assetType, assetId, files }) {
  const type = headerField(assetType, 'assetType');
  const id = headerField(assetId, 'assetId');
  const rows = canonicalSignatureFiles(files);
  const lines = [
    PAYLOAD_VERSION,
    `assetType:${type}`,
    `assetId:${id}`,
    `fileCount:${rows.length}`,
    ...rows.map(file => `${Buffer.byteLength(file.path, 'utf8')}:${file.path}:${file.size}:${file.sha256}`),
  ];
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

const scalarText = value =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;

/**
 * 从 `packages/asset-signature/src/public-keys.ts` 读取内置公钥表，避免复制第二份公钥。
 * 解析不到任何一条时直接抛错（fail closed，不能当作「没有公钥就跳过验签」）。
 */
async function loadBundledPublicKeys() {
  const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'asset-signature', 'src', 'public-keys.ts');
  const text = await readFile(source, 'utf8');
  const keys = {};
  for (const match of text.matchAll(/'([A-Za-z0-9._-]+)'\s*:\s*'([A-Za-z0-9+/=]+)'/g)) keys[match[1]] = match[2];
  if (Object.keys(keys).length === 0) throw new Error(`内置公钥表为空：${source}`);
  return keys;
}

function loadPublicKey(value) {
  if (value.includes('-----BEGIN')) return createPublicKey(value);
  return createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
}

/**
 * 校验一个技能的签名导出文件。返回：
 * - `{ missing: true, target }`：没有导出文件；
 * - `{ ok: false, detail }`：导出文件存在但不可用（结构/文件/摘要/验签任一失败）；
 * - `{ ok: true, assetId, signature }`：可直接写入清单。
 */
async function verifySignatureExport(signaturesDir, name, localFiles, publicKeys) {
  const target = join(signaturesDir, `${name}.json`);
  let text;
  try { text = await readFile(target, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { missing: true, target };
    throw error;
  }
  let value;
  try { value = JSON.parse(text); }
  catch { return { ok: false, detail: `${target} 不是合法 JSON` }; }

  const assetId = scalarText(value?.assetId);
  if (!assetId) return { ok: false, detail: `${target} 缺少 assetId` };
  if (value?.assetType !== 'skill') return { ok: false, detail: `${target} 的 assetType 不是 skill` };
  if (value?.payloadVersion !== PAYLOAD_VERSION) return { ok: false, detail: `${target} 的 payloadVersion 不是 ${PAYLOAD_VERSION}` };
  if (value?.algo !== ALGO) return { ok: false, detail: `${target} 的 algo 不是 ${ALGO}` };
  if (typeof value?.keyId !== 'string' || !value.keyId) return { ok: false, detail: `${target} 缺少 keyId` };
  if (typeof value?.digest !== 'string' || !SHA256_PATTERN.test(value.digest)) return { ok: false, detail: `${target} 的 digest 不是 sha256 十六进制` };
  if (typeof value?.signature !== 'string' || !value.signature) return { ok: false, detail: `${target} 缺少 signature` };

  let declared;
  try { declared = canonicalSignatureFiles(value.files); }
  catch (error) { return { ok: false, detail: `${target} 的 files 不合规：${error.message}` }; }
  if (value.fileCount !== declared.length) {
    return { ok: false, detail: `${target} 的 fileCount=${value.fileCount} 与 files 长度 ${declared.length} 不一致` };
  }

  // 1) 本地文件逐个比 size/sha256，集合必须完全相等。
  let local;
  try { local = canonicalSignatureFiles(localFiles); }
  catch (error) { return { ok: false, detail: `本地文件清单不合规：${error.message}` }; }
  const signed = new Map(declared.map(file => [file.path, file]));
  for (const file of local) {
    const expected = signed.get(file.path);
    if (!expected) return { ok: false, detail: `本地存在签名之外的文件：${file.path}` };
    if (expected.size !== file.size) return { ok: false, detail: `文件大小不一致：${file.path}（签名 ${expected.size}，本地 ${file.size}）` };
    if (expected.sha256 !== file.sha256) return { ok: false, detail: `文件摘要不一致：${file.path}` };
  }
  if (local.length !== declared.length) {
    const present = new Set(local.map(file => file.path));
    const missing = declared.filter(file => !present.has(file.path)).map(file => file.path);
    return { ok: false, detail: `本地缺少签名中的文件：${missing.join(', ') || '(未知)'}` };
  }

  // 2) 用导出文件的 files 重建载荷并比摘要。
  const payload = signaturePayload({ assetType: 'skill', assetId, files: declared });
  const digest = createHash('sha256').update(payload).digest('hex');
  if (digest !== value.digest) return { ok: false, detail: `载荷摘要不一致：计算 ${digest}，签名声明 ${value.digest}` };

  // 3) 内置公钥验 Ed25519。
  const publicKey = publicKeys[value.keyId];
  if (!publicKey) return { ok: false, detail: `内置公钥表缺少 keyId=${value.keyId}` };
  try {
    if (!verifyEd25519(null, payload, loadPublicKey(publicKey), Buffer.from(value.signature, 'base64'))) {
      return { ok: false, detail: `Ed25519 验签未通过（keyId=${value.keyId}）` };
    }
  } catch (error) {
    return { ok: false, detail: `Ed25519 验签失败（keyId=${value.keyId}）：${error instanceof Error ? error.message : String(error)}` };
  }

  return {
    ok: true,
    assetId,
    signature: {
      payloadVersion: value.payloadVersion,
      algo: value.algo,
      keyId: value.keyId,
      digest: value.digest,
      signature: value.signature,
    },
  };
}

async function snapshot(root) {
  const files = [];
  const visit = async (directory, depth) => {
    if (depth > MAX_DEPTH) throw new Error(`asset-manifest/too-deep: ${directory}`);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await visit(path, depth + 1); continue; }
      if (!entry.isFile() || entry.name === MANIFEST_FILE || entry.name === SIGNATURE_CACHE_FILE) continue;
      if (files.length >= MAX_FILES) throw new Error(`asset-manifest/too-many-files: ${root}`);
      const bytes = await readFile(path);
      const info = await stat(path);
      files.push({
        path: relative(root, path).split(sep).join('/'),
        size: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        mtimeMs: Math.round(info.mtimeMs),
      });
    }
  };
  await visit(root, 0);
  return files.sort((a, b) => comparePaths(a.path, b.path));
}

async function readExisting(target) {
  try { return JSON.parse(await readFile(target, 'utf8')); }
  catch { return undefined; }
}

function sameSignature(left, right) {
  if (!left || !right) return left === right;
  return left.payloadVersion === right.payloadVersion
    && left.algo === right.algo
    && left.keyId === right.keyId
    && left.digest === right.digest
    && left.signature === right.signature;
}

function unchanged(existing, name, files, digest, assetId, signature) {
  if (!existing || existing.schema !== SCHEMA) return false;
  return existing.assetType === 'skill'
    && existing.source === 'builtin'
    && existing.name === name
    && existing.assetId === assetId
    && existing.digest === digest
    && sameSignature(existing.signature, signature)
    && Array.isArray(existing.files)
    && JSON.stringify(existing.files) === JSON.stringify(files);
}

async function writeManifest(root, name, options) {
  const files = await snapshot(root);
  const digest = digestOfFiles(files);
  const verified = await verifySignatureExport(options.signaturesDir, name, files, options.publicKeys);

  let assetId;
  let signature;
  if (verified.missing) {
    if (options.mode === 'strict') {
      throw new Error(`内置技能缺少签名导出：${name}（期望 ${verified.target}）。如处于过渡期请设置 WORKDSH_BUILTIN_SIGNATURE_MODE=warn`);
    }
    console.warn(`【过渡期告警】内置技能 ${name} 缺少签名导出（${verified.target}），本次按未签名写入；导出齐备后应切回 strict。`);
  } else if (!verified.ok) {
    if (options.mode === 'strict') throw new Error(`内置技能签名校验失败：${name}：${verified.detail}`);
    console.warn(`【安全告警】内置技能 ${name} 签名校验失败，未写入签名块：${verified.detail}`);
  } else {
    assetId = verified.assetId;
    signature = verified.signature;
  }

  const target = join(root, MANIFEST_FILE);
  const existing = await readExisting(target);
  if (unchanged(existing, name, files, digest, assetId, signature)) return 'unchanged';
  const manifest = {
    schema: SCHEMA,
    assetType: 'skill',
    name,
    source: 'builtin',
    ...(assetId ? { assetId } : {}),
    installedAt: typeof existing?.installedAt === 'string' ? existing.installedAt : new Date().toISOString(),
    files,
    digest,
    ...(signature ? { signature } : {}),
  };
  const temporary = `${target}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(root, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return 'written';
}

async function visitRoot(root, options) {
  const absolute = resolve(root);
  let entries;
  try { entries = await readdir(absolute, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return { root: absolute, skills: 0, written: 0 };
    throw error;
  }
  let skills = 0; let written = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = join(absolute, entry.name);
    // 只认真正含 SKILL.md 的目录，不按名字推断。
    try { if (!(await stat(join(directory, 'SKILL.md'))).isFile()) continue; }
    catch { continue; }
    skills += 1;
    if (await writeManifest(directory, entry.name || basename(directory), options) === 'written') written += 1;
  }
  return { root: absolute, skills, written };
}

function resolveMode(value) {
  const mode = value ?? process.env.WORKDSH_BUILTIN_SIGNATURE_MODE ?? 'strict';
  if (!SIGNATURE_MODES.has(mode)) throw new Error(`WORKDSH_BUILTIN_SIGNATURE_MODE 只支持 strict / warn：${mode}`);
  return mode;
}

/**
 * 对每个根目录下的技能子目录幂等写入内置清单；返回统计，供打包脚本校验。
 * 签名导出目录缺省为 `packages/plugins/skills/builtin-signatures`。
 */
export async function writeBundledSkillManifests(roots, options = {}) {
  const signaturesDir = options.signaturesDir
    ?? process.env.WORKDSH_BUILTIN_SIGNATURES_DIR
    ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'plugins', 'skills', 'builtin-signatures');
  const resolved = {
    signaturesDir,
    mode: resolveMode(options.mode),
    publicKeys: options.publicKeys ?? await loadBundledPublicKeys(),
  };
  const results = [];
  for (const root of roots) results.push(await visitRoot(root, resolved));
  return results;
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const roots = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--signatures' || arg === '--mode') {
      const value = args[index + 1];
      if (!value) { console.error(`${arg} 需要一个值`); process.exit(2); }
      if (arg === '--signatures') options.signaturesDir = value;
      else options.mode = value;
      index += 1;
      continue;
    }
    roots.push(arg);
  }
  if (!roots.length) {
    console.error('usage: node scripts/write-bundled-skill-manifests.mjs [--signatures <dir>] [--mode strict|warn] <skillsRoot> [...]');
    process.exit(2);
  }
  for (const result of await writeBundledSkillManifests(roots, options)) {
    console.log(`bundled skill manifests: ${result.root} skills=${result.skills} written=${result.written}`);
  }
}
