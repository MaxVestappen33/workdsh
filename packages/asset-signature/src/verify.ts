/**
 * 资产签名验签：envelope 一致性 → 与安装位置应有的资产一致 → 字节级重建载荷 →
 * 文件集合/逐文件比对 → 摘要 → Ed25519。
 *
 * 输入既可以是「服务端 files + 暂存区实际文件」（安装前），也可以是
 * 「本地缓存的 envelope + 本地快照」（启用前），两边走同一条判定链。
 */
import { createPublicKey, verify as verifyEd25519 } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import {
  ASSET_SIGNATURE_ALGO,
  ASSET_SIGNATURE_FRESHNESS_MS,
  ASSET_SIGNATURE_PAYLOAD_VERSION,
  ASSET_SIGNATURE_REASON_CODES,
  AssetSignatureError,
  assetSignatureMessage,
  canonicalAssetSignatureFiles,
  canonicalAssetSignaturePayload,
  normalizeAssetPath,
  sha256Hex,
  type AssetSignatureEnvelope,
  type AssetSignatureFile,
  type AssetSignatureReason,
  type AssetSignatureReasonCode,
} from './payload.js';
import { ASSET_SIGNATURE_PUBLIC_KEYS } from './public-keys.js';

export type AssetSignatureVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: AssetSignatureReason;
      readonly code: AssetSignatureReasonCode;
      readonly message: string;
      /** 排障用的具体原因，不直接展示给用户。 */
      readonly detail: string;
    };

export interface VerifyAssetSignatureInput {
  readonly envelope: AssetSignatureEnvelope;
  /** 当前安装位置应有的资产类型（本期固定 `skill`）与后台编号。 */
  readonly expectedAssetType: string;
  readonly expectedAssetId: string;
  /** 磁盘上的实际文件集合（暂存区或已安装目录的快照）。 */
  readonly files: readonly AssetSignatureFile[];
  /** 测试或未来轮换用的公钥表；缺省使用内置表。 */
  readonly publicKeys?: Readonly<Record<string, string>>;
  /** 本地缓存 envelope 的取回时间（毫秒）；提供时执行 24 小时新鲜期检查。 */
  readonly fetchedAt?: number;
  readonly now?: number;
  readonly maxAgeMs?: number;
}

function failure(reason: AssetSignatureReason, detail: string): AssetSignatureVerdict {
  const code = ASSET_SIGNATURE_REASON_CODES[reason];
  return { ok: false, reason, code, message: assetSignatureMessage(code), detail };
}

const detailOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** 支持 PEM 与 base64 DER SPKI 两种公钥写法。 */
function loadPublicKey(value: string): KeyObject {
  if (value.includes('-----BEGIN')) return createPublicKey(value);
  return createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
}

/** 按签名链路的固定顺序验签；任何一步失败都返回原因码，绝不放行。 */
export function verifyAssetSignature(input: VerifyAssetSignatureInput): AssetSignatureVerdict {
  const envelope = input.envelope;

  // 1) 离线缓存新鲜期：超过窗口等于没有可用签名。
  if (input.fetchedAt !== undefined) {
    const now = input.now ?? Date.now();
    const maxAge = input.maxAgeMs ?? ASSET_SIGNATURE_FRESHNESS_MS;
    if (!Number.isFinite(input.fetchedAt)) return failure('missing', '本地签名缓存缺少取得时间');
    if (now - input.fetchedAt > maxAge) {
      return failure('missing', `本地签名缓存已超过 ${Math.round(maxAge / 3_600_000)} 小时（fetchedAt=${new Date(input.fetchedAt).toISOString()}）`);
    }
  }

  // 2) envelope 自身一致性。
  if (envelope.payloadVersion !== ASSET_SIGNATURE_PAYLOAD_VERSION) {
    return failure('invalid', `载荷版本不是 ${ASSET_SIGNATURE_PAYLOAD_VERSION}：${envelope.payloadVersion}`);
  }
  if (envelope.algo !== ASSET_SIGNATURE_ALGO) return failure('invalid', `签名算法不是 ${ASSET_SIGNATURE_ALGO}：${envelope.algo}`);
  if (envelope.fileCount !== envelope.files.length) {
    return failure('invalid', `fileCount=${envelope.fileCount} 与 files 长度 ${envelope.files.length} 不一致`);
  }

  // 3) 防 B 资产的签名被搬到 A 的安装位置。
  if (envelope.assetType !== input.expectedAssetType) {
    return failure('asset-mismatch', `签名资产类型是 ${envelope.assetType}，当前位置需要 ${input.expectedAssetType}`);
  }
  if (envelope.assetId !== input.expectedAssetId) {
    return failure('asset-mismatch', `签名资产编号是 ${envelope.assetId}，当前安装位置对应 ${input.expectedAssetId}`);
  }

  // 4) 规范化服务端签名文件集合并重建载荷（用服务端 files，不用本地扫描结果）。
  let signedFiles: readonly AssetSignatureFile[];
  let payload: Buffer;
  try {
    signedFiles = canonicalAssetSignatureFiles(envelope.files);
    payload = canonicalAssetSignaturePayload({ assetType: envelope.assetType, assetId: envelope.assetId, files: signedFiles });
  } catch (error) {
    if (error instanceof AssetSignatureError) return failure('invalid', error.detail ?? error.message);
    return failure('invalid', detailOf(error));
  }

  // 5) 路径集合完全相等、逐文件 size/sha256 相等。
  let localFiles: readonly AssetSignatureFile[];
  try {
    localFiles = canonicalAssetSignatureFiles(input.files);
  } catch (error) {
    return failure('manifest-mismatch', `本地文件无法参与签名比对：${detailOf(error)}`);
  }
  const signed = new Map(signedFiles.map(file => [file.path, file]));
  for (const file of localFiles) {
    let path: string;
    try { path = normalizeAssetPath(file.path); }
    catch (error) { return failure('manifest-mismatch', `本地文件路径不合规：${detailOf(error)}`); }
    const expected = signed.get(path);
    if (!expected) return failure('manifest-extra-file', `本地存在签名之外的文件：${path}`);
    if (expected.size !== file.size) return failure('manifest-mismatch', `文件大小不一致：${path}（签名 ${expected.size}，本地 ${file.size}）`);
    if (expected.sha256 !== file.sha256) return failure('manifest-mismatch', `文件摘要不一致：${path}`);
  }
  if (localFiles.length !== signedFiles.length) {
    const local = new Set(localFiles.map(file => normalizeAssetPath(file.path)));
    const missing = [...signed.keys()].filter(path => !local.has(path));
    return failure('manifest-mismatch', `本地缺少签名中的文件：${missing.join(', ') || '(未知)'}`);
  }

  // 6) 载荷摘要必须与签名记录一致。
  if (sha256Hex(payload) !== envelope.digest) {
    return failure('invalid', `载荷摘要不一致：计算 ${sha256Hex(payload)}，签名声明 ${envelope.digest}`);
  }

  // 7) 按 keyId 选内置公钥；缺失即拒绝（公钥未就绪时不允许放行）。
  const keys = input.publicKeys ?? ASSET_SIGNATURE_PUBLIC_KEYS;
  const publicKey = keys[envelope.keyId];
  if (!publicKey) return failure('missing', `内置公钥表缺少 keyId=${envelope.keyId} 对应的公钥`);

  // 8) Ed25519 验签（签名是 64 字节原始数据）。
  try {
    const key = loadPublicKey(publicKey);
    if (!verifyEd25519(null, payload, key, Buffer.from(envelope.signature, 'base64'))) {
      return failure('invalid', `Ed25519 验签未通过（keyId=${envelope.keyId}）`);
    }
  } catch (error) {
    return failure('invalid', `Ed25519 验签失败（keyId=${envelope.keyId}）：${detailOf(error)}`);
  }
  return { ok: true };
}
