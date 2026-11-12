/**
 * 授权快照的解析与新鲜度判断。
 *
 * 后台回包有两种形态：
 * - 带 revision 且命中：{ revision, unchanged: true }
 * - 其余：{ revision, unchanged: false, staleAt, generatedAt, assets }
 *
 * 快照的生命周期上限由 staleAt 与登录态共同决定；登录态失效由宿主清空缓存来体现。
 */
import { ASSET_TYPES, type AssetType, type SnapshotResult } from './types.js';
import { AssetGateError } from './errors.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assetIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.flatMap(item => {
    const id = asText(item);
    return id ? [id] : [];
  });
  return [...new Set(ids)];
}

/** 解析快照回包；revision 缺失视为不可识别，避免把旧数据当新数据使用。 */
export function parseSnapshotResult(value: unknown): SnapshotResult {
  const record = asRecord(value);
  if (!record) throw new AssetGateError('asset-gate/response-invalid', '授权快照回包无法识别。');
  const revision = asText(record.revision);
  if (!revision) throw new AssetGateError('asset-gate/response-invalid', '授权快照缺少修订号。');
  if (record.unchanged === true) return { unchanged: true, revision };
  const assets = asRecord(record.assets);
  return {
    unchanged: false,
    revision,
    generatedAt: asText(record.generatedAt) || undefined,
    staleAt: asText(record.staleAt) || null,
    assets: Object.fromEntries(
      ASSET_TYPES.map(type => [type, assetIds(assets?.[type])]),
    ) as Record<AssetType, readonly string[]>,
  };
}

/**
 * 是否已超过授权时限。空值表示后台未给出时限；无法解析的时间按已过期处理，
 * 宁可拒绝也不把不可信的快照当有效授权。
 */
export function snapshotExpired(staleAt: string | null | undefined, now: number): boolean {
  const raw = staleAt?.trim();
  if (!raw) return false;
  const deadline = Date.parse(raw);
  if (Number.isNaN(deadline)) return true;
  return now >= deadline;
}
