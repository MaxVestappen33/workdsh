import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

/**
 * 安装清单（sidecar）：随资产目录一起存放的隐藏文件。
 * 它记录「这个本机资产从哪来、对应哪个后台编号、装了哪些文件」，
 * 用于替代按名字或目录成员身份猜测来源的旧做法。
 */
export const ASSET_MANIFEST_FILE = '.workdsh-install.json';

/** 清单结构版本：结构变化时递增，读取端拒绝不认识的版本。 */
export const ASSET_MANIFEST_SCHEMA = 2;
/** 旧版清单：没有签名块，读取时按「无签名资产」处理，不能当作合法签名。 */
export const ASSET_MANIFEST_SCHEMA_LEGACY = 1;

/**
 * 签名 envelope 的本地缓存文件（与清单同目录）。
 * 离线窗口内启用资产时用它验签；它不属于资产内容，扫描与摘要都必须排除。
 */
export const ASSET_SIGNATURE_CACHE_FILE = '.workdsh-asset-signature.json';

export type AssetManifestType = 'skill' | 'mcp' | 'expert' | 'expert_group' | 'model';

/** 来源：市场安装 / 随包内置（含从内置目录安装的副本） / 本机自建或导入。 */
export type AssetManifestSource = 'market' | 'builtin' | 'local';

export interface AssetManifestFile {
  /** 相对资产目录的路径，统一使用 `/` 分隔。 */
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  /** 写入清单时的大小与修改时间，用于校验时先做廉价比对。 */
  readonly mtimeMs: number;
}

/** 后台签名接口返回的签名块（与安装清单里的签名块字段一致）。 */
export interface AssetManifestSignature {
  readonly payloadVersion: string;
  readonly algo: string;
  readonly keyId: string;
  /** 载荷 sha256 小写十六进制。 */
  readonly digest: string;
  /** Ed25519 签名（base64，原始 64 字节）。 */
  readonly signature: string;
}

export interface AssetManifest {
  /** 2 = 当前结构；1 = 旧结构（只读兼容，按无签名处理）。 */
  readonly schema: 1 | 2;
  readonly assetType: AssetManifestType;
  /** 本机资产标识（技能名、连接器名等），仅用于展示与排障，不作为来源判据。 */
  readonly name: string;
  readonly source: AssetManifestSource;
  /** 后台资产编号；builtin 与 local 没有。 */
  readonly assetId?: string;
  readonly installedAt: string;
  readonly version?: string;
  readonly files: readonly AssetManifestFile[];
  /** 文件清单摘要，见 assetManifestDigest。 */
  readonly digest: string;
  /** schema 2 起可选：资产签名。没有签名块表示未签名资产。 */
  readonly signature?: AssetManifestSignature;
}

export interface AssetManifestInput {
  readonly assetType: AssetManifestType;
  readonly name: string;
  readonly source: AssetManifestSource;
  readonly assetId?: string;
  readonly installedAt?: string;
  readonly version?: string;
  readonly signature?: AssetManifestSignature;
}

export type AssetManifestVerdict =
  | { readonly ok: true; readonly checked: 'sha256' }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'file-missing' | 'quick-mismatch' | 'digest-mismatch';
      readonly checked: 'quick' | 'sha256';
    };

const maximumFiles = 1000;
const maximumDepth = 8;

export function assetManifestPath(root: string): string {
  return join(root, ASSET_MANIFEST_FILE);
}

/**
 * 单文件资产的旁挂清单路径：与原文件同目录，名字带上原文件名。
 * 例如 `demo.md` → `.demo.md.workdsh-install.json`。
 *
 * 改名后旁挂文件对不上，等于没有清单（按用户自建处理）；这是有意为之，
 * 不做名字模糊匹配或按摘要全盘扫描，避免张冠李戴。
 */
export function assetFileManifestPath(file: string): string {
  return join(dirname(file), `.${basename(file)}${ASSET_MANIFEST_FILE}`);
}

/** 目录资产的签名缓存路径。 */
export function assetSignatureCachePath(root: string): string {
  return join(root, ASSET_SIGNATURE_CACHE_FILE);
}

/** 单文件资产的签名缓存路径：`.demo.md.workdsh-asset-signature.json`。 */
export function assetFileSignatureCachePath(file: string): string {
  return join(dirname(file), `.${basename(file)}${ASSET_SIGNATURE_CACHE_FILE}`);
}

/**
 * 路径排序：按 UTF-8 字节无符号升序，与签名载荷的排序口径一致。
 * 不能用 localeCompare——它按语言规则比较，`SKILL.md` 与 `scripts/run.md` 的先后会与字节序相反。
 */
export function compareAssetPaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/** 文件清单摘要：按路径字节序排序后对 path/size/sha256 求 sha256，不含修改时间。 */
export function assetManifestDigest(files: readonly AssetManifestFile[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => compareAssetPaths(a.path, b.path))) {
    hash.update(file.path); hash.update('\0');
    hash.update(String(file.size)); hash.update('\0');
    hash.update(file.sha256); hash.update('\0');
  }
  return hash.digest('hex');
}

/** 扫描资产目录：跳过符号链接、清单自身与签名缓存，返回按路径字节序排序的文件清单。 */
export async function snapshotAssetFiles(root: string, signal?: AbortSignal): Promise<readonly AssetManifestFile[]> {
  const files: AssetManifestFile[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    if (depth > maximumDepth) throw new Error('asset-manifest/too-deep');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await visit(path, depth + 1); continue; }
      if (!entry.isFile() || entry.name === ASSET_MANIFEST_FILE || entry.name === ASSET_SIGNATURE_CACHE_FILE) continue;
      if (files.length >= maximumFiles) throw new Error('asset-manifest/too-many-files');
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
  return files.sort((a, b) => compareAssetPaths(a.path, b.path));
}

/** 写入清单：先扫描并求摘要，再原子替换；清单自身不计入文件清单。 */
export async function writeAssetManifest(root: string, input: AssetManifestInput, signal?: AbortSignal): Promise<AssetManifest> {
  await mkdir(root, { recursive: true });
  const files = await snapshotAssetFiles(root, signal);
  const manifest = buildManifest(files, input);
  await writeManifestFile(assetManifestPath(root), manifest);
  return manifest;
}

/** 写入单文件资产的旁挂清单：文件清单只含该文件本身。 */
export async function writeAssetFileManifest(file: string, input: AssetManifestInput, signal?: AbortSignal): Promise<AssetManifest> {
  signal?.throwIfAborted();
  const info = await stat(file);
  const bytes = await readFile(file);
  const manifest = buildManifest([{
    path: basename(file),
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mtimeMs: Math.round(info.mtimeMs),
  }], input);
  await writeManifestFile(assetFileManifestPath(file), manifest);
  return manifest;
}

function buildManifest(files: readonly AssetManifestFile[], input: AssetManifestInput): AssetManifest {
  return {
    schema: ASSET_MANIFEST_SCHEMA,
    assetType: input.assetType,
    name: input.name,
    source: input.source,
    ...(input.assetId ? { assetId: input.assetId } : {}),
    installedAt: input.installedAt ?? new Date().toISOString(),
    ...(input.version ? { version: input.version } : {}),
    files,
    digest: assetManifestDigest(files),
    ...(input.signature ? { signature: input.signature } : {}),
  };
}

async function writeManifestFile(target: string, manifest: AssetManifest): Promise<void> {
  const temporary = `${target}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

function parseAssetManifest(value: unknown): AssetManifest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  // schema 1 旧清单只读兼容：按「无签名资产」处理，签名块一律忽略，不能当作合法签名。
  const schema = row.schema;
  if (schema !== ASSET_MANIFEST_SCHEMA && schema !== ASSET_MANIFEST_SCHEMA_LEGACY) return undefined;
  const assetType = row.assetType;
  const source = row.source;
  if (assetType !== 'skill' && assetType !== 'mcp' && assetType !== 'expert' && assetType !== 'expert_group' && assetType !== 'model') return undefined;
  if (source !== 'market' && source !== 'builtin' && source !== 'local') return undefined;
  if (typeof row.name !== 'string' || !row.name || typeof row.installedAt !== 'string' || typeof row.digest !== 'string') return undefined;
  if (row.assetId !== undefined && typeof row.assetId !== 'string') return undefined;
  if (row.version !== undefined && typeof row.version !== 'string') return undefined;
  if (!Array.isArray(row.files)) return undefined;
  const files: AssetManifestFile[] = [];
  for (const item of row.files) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const file = item as Record<string, unknown>;
    if (typeof file.path !== 'string' || !file.path || typeof file.size !== 'number' || typeof file.sha256 !== 'string' || typeof file.mtimeMs !== 'number') return undefined;
    files.push({ path: file.path, size: file.size, sha256: file.sha256, mtimeMs: file.mtimeMs });
  }
  const signature = schema === ASSET_MANIFEST_SCHEMA ? parseAssetManifestSignature(row.signature) : undefined;
  if (signature === null) return undefined;
  return {
    schema,
    assetType, name: row.name, source,
    ...(row.assetId ? { assetId: row.assetId } : {}),
    installedAt: row.installedAt,
    ...(row.version ? { version: row.version } : {}),
    files,
    digest: row.digest,
    ...(signature ? { signature } : {}),
  };
}

/** 解析签名块：缺省返回 undefined；结构损坏返回 null（整条清单按损坏处理）。 */
function parseAssetManifestSignature(value: unknown): AssetManifestSignature | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const field of ['payloadVersion', 'algo', 'keyId', 'digest', 'signature'] as const) {
    if (typeof row[field] !== 'string' || !row[field]) return null;
  }
  return {
    payloadVersion: row.payloadVersion as string,
    algo: row.algo as string,
    keyId: row.keyId as string,
    digest: row.digest as string,
    signature: row.signature as string,
  };
}

/** 读取清单：文件不存在、内容损坏或结构不认识都按「没有清单」处理，不抛错。 */
export async function readAssetManifest(root: string): Promise<AssetManifest | undefined> {
  return readManifestFile(assetManifestPath(root));
}

/** 读取单文件资产的旁挂清单；同样按「没有清单」处理各种异常。 */
export async function readAssetFileManifest(file: string): Promise<AssetManifest | undefined> {
  return readManifestFile(assetFileManifestPath(file));
}

async function readManifestFile(target: string): Promise<AssetManifest | undefined> {
  let text: string;
  try { text = await readFile(target, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try { return parseAssetManifest(JSON.parse(text)); }
  catch { return undefined; }
}

/**
 * 校验清单：未签名资产先比大小与修改时间，再算 sha256 比摘要；
 * 签名资产不使用 mtime 短路（mtime 可被原样保留），直接做文件集合与摘要比对，
 * 签名本身的 Ed25519 验签由调用方用同目录缓存的 envelope 完成。
 */
export async function verifyAssetManifest(root: string, signal?: AbortSignal): Promise<AssetManifestVerdict> {
  const manifest = await readAssetManifest(root);
  if (!manifest) return { ok: false, reason: 'missing', checked: 'quick' };
  const signed = manifest.signature !== undefined;
  for (const file of manifest.files) {
    signal?.throwIfAborted();
    let info;
    try { info = await stat(join(root, file.path)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: 'file-missing', checked: 'quick' };
      throw error;
    }
    if (!info.isFile() || info.size !== file.size || (!signed && Math.round(info.mtimeMs) !== file.mtimeMs)) {
      return { ok: false, reason: 'quick-mismatch', checked: 'quick' };
    }
  }
  const files = await snapshotAssetFiles(root, signal);
  if (assetManifestDigest(files) !== manifest.digest) return { ok: false, reason: 'digest-mismatch', checked: 'sha256' };
  return { ok: true, checked: 'sha256' };
}

/** 校验单文件资产：未签名资产先比大小与修改时间；签名资产跳过 mtime，直接比 sha256。 */
export async function verifyAssetFileManifest(file: string, signal?: AbortSignal): Promise<AssetManifestVerdict> {
  const manifest = await readAssetFileManifest(file);
  if (!manifest) return { ok: false, reason: 'missing', checked: 'quick' };
  const expected = manifest.files.find(entry => entry.path === basename(file));
  if (!expected) return { ok: false, reason: 'missing', checked: 'quick' };
  signal?.throwIfAborted();
  let info;
  try { info = await stat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: 'file-missing', checked: 'quick' };
    throw error;
  }
  const signed = manifest.signature !== undefined;
  if (!info.isFile() || info.size !== expected.size || (!signed && Math.round(info.mtimeMs) !== expected.mtimeMs)) {
    return { ok: false, reason: 'quick-mismatch', checked: 'quick' };
  }
  const sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
  if (sha256 !== expected.sha256 || assetManifestDigest(manifest.files) !== manifest.digest) {
    return { ok: false, reason: 'digest-mismatch', checked: 'sha256' };
  }
  return { ok: true, checked: 'sha256' };
}
