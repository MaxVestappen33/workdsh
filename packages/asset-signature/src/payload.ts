/**
 * 资产签名载荷（workdsh-asset-signature-v1）的唯一构造口径。
 *
 * 后台按同一份规则生成签名，客户端只能复现这份规则来验签：
 * 任何一处规范化差异（Unicode 归一化、路径分隔符、排序、行尾）都会让签名永远验不过，
 * 因此这里不做「宽松处理」——遇到不合规的路径或字段一律按签名无效拒绝。
 */
import { createHash } from 'node:crypto';

export const ASSET_SIGNATURE_PAYLOAD_VERSION = 'workdsh-asset-signature-v1';
export const ASSET_SIGNATURE_ALGO = 'Ed25519';
/** 本期只对技能签名；其它资产类型不请求签名。 */
export const ASSET_SIGNATURE_ASSET_TYPES = ['skill'] as const;

export const ASSET_SIGNATURE_MAX_FILES = 1000;
export const ASSET_SIGNATURE_MAX_PATH_BYTES = 512;
export const ASSET_SIGNATURE_MAX_DEPTH = 8;
/** 签名 envelope 的本地缓存新鲜期：与授权快照同为 24 小时，超窗按「无签名」拒绝。 */
export const ASSET_SIGNATURE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * 签名校验失败的原因码。只在这里定义一次，asset-gate 的 reasons.ts 直接引用，
 * 保证审计上报、界面文案与拒绝原因同一个来源。
 */
export const ASSET_SIGNATURE_REASONS = {
  /** 没有签名（接口未配置、验签失败但无 envelope、公钥未内置、离线缓存超过 24 小时）。 */
  missing: 'gate/denied-signature-missing',
  /** 签名 envelope 结构不合法、摘要不符或 Ed25519 验签失败。 */
  invalid: 'gate/denied-signature-invalid',
  /** envelope 里的 assetType/assetId 与当前安装位置应有的资产不一致（把 B 的签名搬到 A）。 */
  assetMismatch: 'gate/denied-signature-asset-mismatch',
  /** 文件集合或逐文件 size/sha256 与签名载荷不一致。 */
  manifestMismatch: 'gate/denied-manifest-mismatch',
  /** 本地存在签名载荷之外的多余文件。 */
  manifestExtraFile: 'gate/denied-manifest-extra-file',
} as const;

/** 签名校验失败的语义分类；对外的原因码见 ASSET_SIGNATURE_REASONS。 */
export type AssetSignatureReason = 'missing' | 'invalid' | 'asset-mismatch' | 'manifest-mismatch' | 'manifest-extra-file';
export type AssetSignatureReasonCode = typeof ASSET_SIGNATURE_REASONS[keyof typeof ASSET_SIGNATURE_REASONS];

/** 语义分类 → 对外稳定原因码。 */
export const ASSET_SIGNATURE_REASON_CODES: Readonly<Record<AssetSignatureReason, AssetSignatureReasonCode>> = {
  missing: ASSET_SIGNATURE_REASONS.missing,
  invalid: ASSET_SIGNATURE_REASONS.invalid,
  'asset-mismatch': ASSET_SIGNATURE_REASONS.assetMismatch,
  'manifest-mismatch': ASSET_SIGNATURE_REASONS.manifestMismatch,
  'manifest-extra-file': ASSET_SIGNATURE_REASONS.manifestExtraFile,
};

export const ASSET_SIGNATURE_REASON_MESSAGES: Readonly<Record<AssetSignatureReasonCode, string>> = {
  [ASSET_SIGNATURE_REASONS.missing]: '该资产缺少有效签名（或离线超过 24 小时），已拒绝执行。',
  [ASSET_SIGNATURE_REASONS.invalid]: '资产签名无效，内容可能被篡改，已拒绝执行。',
  [ASSET_SIGNATURE_REASONS.assetMismatch]: '资产签名与当前安装位置不匹配，已拒绝执行。',
  [ASSET_SIGNATURE_REASONS.manifestMismatch]: '资产文件与签名记录不一致，内容可能被篡改，已拒绝执行。',
  [ASSET_SIGNATURE_REASONS.manifestExtraFile]: '资产目录存在签名之外的多余文件，已拒绝执行。',
};

/** 取原因码文案；未知码回退为「签名无效」，避免把异常数据当成放行理由。 */
export function assetSignatureMessage(code: string): string {
  return ASSET_SIGNATURE_REASON_MESSAGES[code as AssetSignatureReasonCode] ?? ASSET_SIGNATURE_REASON_MESSAGES[ASSET_SIGNATURE_REASONS.invalid];
}

/** 签名链路的拒绝错误：code 是 gate/denied-* 原因码，message 可直接给用户看。 */
export class AssetSignatureError extends Error {
  constructor(readonly code: AssetSignatureReasonCode, message: string, readonly detail?: string) {
    super(message);
    this.name = 'AssetSignatureError';
  }
}

/** 参与签名的单个文件：path 是相对资产根的路径，size 是字节数，sha256 是小写十六进制。 */
export interface AssetSignatureFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

/** 后台签名接口返回的 envelope（字段与契约一一对应）。 */
export interface AssetSignatureEnvelope {
  readonly assetType: string;
  readonly assetId: string;
  readonly payloadVersion: string;
  readonly algo: string;
  readonly keyId: string;
  readonly digest: string;
  readonly signature: string;
  readonly fileCount: number;
  readonly files: readonly AssetSignatureFile[];
  readonly signedAt: string;
}

/** 本地缓存的签名 envelope：fetchedAt 是取回时间（毫秒），用于 24 小时离线窗口。 */
export interface AssetSignatureCacheRecord {
  readonly fetchedAt: number;
  readonly envelope: AssetSignatureEnvelope;
}

const reasonMessage = (reason: AssetSignatureReason): string => ASSET_SIGNATURE_REASON_MESSAGES[ASSET_SIGNATURE_REASON_CODES[reason]];
const invalid = (detail: string): AssetSignatureError =>
  new AssetSignatureError(ASSET_SIGNATURE_REASONS.invalid, reasonMessage('invalid'), detail);

const controlPattern = /[\u0000-\u001f\u007f]/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/u;

/**
 * 规范化相对路径：NFC、`/` 分隔，禁止反斜杠、冒号、控制字符、空层级、`.`、`..`；
 * 路径不超过 512 字节、层级不超过 8 层。返回的字符串可直接参与载荷拼接。
 */
export function normalizeAssetPath(raw: string): string {
  if (typeof raw !== 'string' || !raw) throw invalid('文件路径为空');
  const path = raw.normalize('NFC');
  if (controlPattern.test(path)) throw invalid(`文件路径包含控制字符：${JSON.stringify(raw)}`);
  if (path.includes('\\')) throw invalid(`文件路径使用了反斜杠：${path}`);
  if (path.includes(':')) throw invalid(`文件路径包含冒号：${path}`);
  if (path.startsWith('/')) throw invalid(`文件路径不能是绝对路径：${path}`);
  const segments = path.split('/');
  if (segments.some(segment => segment === '')) throw invalid(`文件路径包含空层级：${path}`);
  if (segments.some(segment => segment === '.' || segment === '..')) throw invalid(`文件路径包含 . 或 ..：${path}`);
  if (segments.length > ASSET_SIGNATURE_MAX_DEPTH) throw invalid(`文件路径层级超过 ${ASSET_SIGNATURE_MAX_DEPTH}：${path}`);
  if (Buffer.byteLength(path, 'utf8') > ASSET_SIGNATURE_MAX_PATH_BYTES) throw invalid(`文件路径超过 ${ASSET_SIGNATURE_MAX_PATH_BYTES} 字节：${path}`);
  return path;
}

/**
 * 路径排序：按 UTF-8 字节无符号升序。
 * 不能用 localeCompare——它按语言规则比较，`SKILL.md` 与 `scripts/run.md` 的先后会与字节序相反。
 */
export function compareAssetPaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/** 载荷与摘要统一使用的小写十六进制 sha256。 */
export function sha256Hex(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 校验并规范化参与签名的文件集合：去重、按字节序排序。 */
export function canonicalAssetSignatureFiles(files: readonly AssetSignatureFile[]): readonly AssetSignatureFile[] {
  if (!Array.isArray(files)) throw invalid('文件列表不是数组');
  if (files.length > ASSET_SIGNATURE_MAX_FILES) throw invalid(`文件数超过 ${ASSET_SIGNATURE_MAX_FILES}：${files.length}`);
  const seen = new Set<string>();
  const rows = files.map(file => {
    const path = normalizeAssetPath(file?.path);
    if (seen.has(path)) throw invalid(`文件路径重复：${path}`);
    seen.add(path);
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw invalid(`文件大小无效：${path}`);
    if (typeof file.sha256 !== 'string' || !sha256Pattern.test(file.sha256)) throw invalid(`文件摘要无效：${path}`);
    return { path, size: file.size, sha256: file.sha256 };
  });
  return rows.sort((left, right) => compareAssetPaths(left.path, right.path));
}

/** 头部字段（assetType / assetId）：非空、无控制字符、无冒号、无首尾空白。 */
function headerField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) throw invalid(`${field} 为空或包含首尾空白`);
  if (controlPattern.test(value)) throw invalid(`${field} 包含控制字符`);
  if (value.includes(':')) throw invalid(`${field} 包含冒号`);
  return value;
}

/**
 * 构造规范化载荷。输出为 UTF-8、无 BOM、`\n` 行尾，最后一行同样带 `\n`：
 *
 * ```
 * workdsh-asset-signature-v1
 * assetType:skill
 * assetId:1857
 * fileCount:2
 * 8:SKILL.md:3:ba78...
 * 14:scripts/run.md:2:8f43...
 * ```
 */
export function canonicalAssetSignaturePayload(input: {
  readonly assetType: string;
  readonly assetId: string;
  readonly files: readonly AssetSignatureFile[];
}): Buffer {
  const assetType = headerField(input.assetType, 'assetType');
  const assetId = headerField(input.assetId, 'assetId');
  const files = canonicalAssetSignatureFiles(input.files);
  const lines = [
    ASSET_SIGNATURE_PAYLOAD_VERSION,
    `assetType:${assetType}`,
    `assetId:${assetId}`,
    `fileCount:${files.length}`,
    ...files.map(file => `${Buffer.byteLength(file.path, 'utf8')}:${file.path}:${file.size}:${file.sha256}`),
  ];
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

/** 后台返回的 assetId 可能是字符串或数字（Java Long），统一转成字符串比较。 */
const scalarText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : undefined;

/**
 * 严格解析后台签名响应。任何字段缺失/类型不符都按「签名无效」拒绝：
 * 失败必须是 fail closed，不能把坏数据当作「无签名可放行」。
 */
export function parseAssetSignatureEnvelope(value: unknown): AssetSignatureEnvelope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid('签名响应不是对象');
  const row = value as Record<string, unknown>;
  const assetType = scalarText(row.assetType);
  const assetId = scalarText(row.assetId);
  if (!assetType) throw invalid('签名响应缺少 assetType');
  if (!assetId) throw invalid('签名响应缺少 assetId');
  if (typeof row.payloadVersion !== 'string' || !row.payloadVersion) throw invalid('签名响应缺少 payloadVersion');
  if (typeof row.algo !== 'string' || !row.algo) throw invalid('签名响应缺少 algo');
  if (typeof row.keyId !== 'string' || !row.keyId) throw invalid('签名响应缺少 keyId');
  if (typeof row.digest !== 'string' || !sha256Pattern.test(row.digest)) throw invalid('签名响应的 digest 不是 sha256 小写十六进制');
  if (typeof row.signature !== 'string' || !base64Pattern.test(row.signature)) throw invalid('签名响应的 signature 不是 base64');
  if (Buffer.from(row.signature, 'base64').byteLength !== 64) throw invalid('签名长度不是 64 字节');
  if (!Number.isSafeInteger(row.fileCount) || (row.fileCount as number) < 0) throw invalid('签名响应的 fileCount 无效');
  if (!Array.isArray(row.files)) throw invalid('签名响应缺少 files 数组');
  const files: AssetSignatureFile[] = [];
  for (const item of row.files) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw invalid('签名响应的文件项不是对象');
    const file = item as Record<string, unknown>;
    if (typeof file.path !== 'string' || !file.path) throw invalid('签名响应的文件项缺少 path');
    if (!Number.isSafeInteger(file.size) || (file.size as number) < 0) throw invalid(`签名响应的文件大小无效：${file.path}`);
    if (typeof file.sha256 !== 'string' || !sha256Pattern.test(file.sha256)) throw invalid(`签名响应的文件摘要无效：${file.path}`);
    files.push({ path: file.path, size: file.size as number, sha256: file.sha256 });
  }
  const signedAt = scalarText(row.signedAt) ?? '';
  return {
    assetType,
    assetId,
    payloadVersion: row.payloadVersion,
    algo: row.algo,
    keyId: row.keyId,
    digest: row.digest,
    signature: row.signature,
    fileCount: row.fileCount as number,
    files,
    signedAt,
  };
}

/** 解析本地缓存的签名 envelope；缺失或损坏返回 undefined（按「无签名」处理）。 */
export function parseAssetSignatureCache(value: unknown): AssetSignatureCacheRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const fetchedAt = typeof row.fetchedAt === 'number'
    ? row.fetchedAt
    : typeof row.fetchedAt === 'string'
      ? Date.parse(row.fetchedAt)
      : Number.NaN;
  if (!Number.isFinite(fetchedAt)) return undefined;
  try {
    return { fetchedAt, envelope: parseAssetSignatureEnvelope(row.envelope) };
  } catch {
    return undefined;
  }
}
