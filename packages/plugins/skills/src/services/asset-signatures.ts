/**
 * 签名 envelope 的本地缓存读写，以及单文件快照。
 *
 * 缓存文件与安装清单同目录（`.workdsh-asset-signature.json`），记录取回时间与
 * 后台返回的完整 envelope；启用前校验只认它，超过 24 小时按「无签名」拒绝。
 * 文件本身不属于资产内容，asset-manifest 的快照与摘要都已排除它。
 */
import { createHash } from 'node:crypto';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  assetFileSignatureCachePath,
  assetSignatureCachePath,
  type AssetManifestFile,
} from 'workdsh-asset-manifest';
import { parseAssetSignatureCache, type AssetSignatureCacheRecord, type AssetSignatureEnvelope } from 'workdsh-asset-signature';

/** 目录资产与单文件资产各自使用同口径的缓存路径。 */
export function signatureCachePath(target: string, directory: boolean): string {
  return directory ? assetSignatureCachePath(target) : assetFileSignatureCachePath(target);
}

/**
 * 验签开关开启后，市场资产缺少签名（装于关闭期间）时给用户看的文案。
 * 原因码仍是 `gate/denied-signature-missing`，这里只负责说明「怎么解决」。
 */
export const SIGNATURE_REINSTALL_MESSAGE = '该资产安装于签名校验关闭期间，请重新安装。';

/** 原子写入缓存：先写临时文件再改名，失败时清掉临时文件。 */
export async function writeSignatureCache(path: string, envelope: AssetSignatureEnvelope, fetchedAt = Date.now()): Promise<void> {
  const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ fetchedAt, envelope }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

/** 读取缓存：不存在或损坏都返回 undefined，由调用方按「无签名」拒绝。 */
export async function readSignatureCache(path: string): Promise<AssetSignatureCacheRecord | undefined> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try { return parseAssetSignatureCache(JSON.parse(text)); } catch { return undefined; }
}

/** 单文件资产的快照：path 用文件名，与签名载荷里的 path 同口径。 */
export async function snapshotAssetFile(file: string, signal?: AbortSignal): Promise<AssetManifestFile> {
  signal?.throwIfAborted();
  const info = await stat(file);
  const bytes = await readFile(file);
  return {
    path: basename(file),
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mtimeMs: Math.round(info.mtimeMs),
  };
}
