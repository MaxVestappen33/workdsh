/**
 * 判定器：纯函数，无 IO、无单例、无隐藏时钟（now 可显式传入）。
 *
 * 判定顺序固定，保证「关闸零开销」：
 * 1. 主闸门关闭 → 直接放行，不读取快照任何字段；
 * 2. 该类型子闸门关闭 → 直接放行，不读取快照任何字段；
 * 3. 只有两级闸门都开启后，才检查快照是否存在、是否过期、是否命中授权；
 * 4. 写操作（安装、启用/恢复）额外要求快照在 24 小时新鲜期内，读/用不受此限制。
 *
 * 不允许把顺序改成「先算再放行」：快照对象可能是延迟加载/加密解开的，
 * 提前读取会破坏零开销约定。
 */
import { GATE_REASONS, gateReasonMessage, type GateReasonCode } from './reasons.js';
import { snapshotExpired } from './snapshot.js';
import type { DecisionInput, GateDecision, GateAssetType, AssetUsage } from './types.js';

/** 写操作允许离线使用快照的上限：以快照自身的 `fetchedAt`（最近一次成功拉取时间）为准。 */
export const SNAPSHOT_WRITE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/** 新鲜期判定：时间不可解析视为不新鲜（fail-closed），未来时间按新鲜处理。 */
function snapshotFresh(fetchedAt: string, now: number): boolean {
  const pulledAt = Date.parse(fetchedAt);
  if (!Number.isFinite(pulledAt)) return false;
  return now - pulledAt <= SNAPSHOT_WRITE_FRESHNESS_MS;
}

interface Identity {
  readonly assetType: GateAssetType;
  readonly assetId: string;
  readonly usage: AssetUsage;
}

function result(allow: boolean, reason: GateReasonCode, identity: Identity, snapshotRevision?: string): GateDecision {
  return {
    allow,
    reason,
    message: gateReasonMessage(reason),
    ...identity,
    ...(snapshotRevision === undefined ? {} : { snapshotRevision }),
  };
}

export function decide(input: DecisionInput): GateDecision {
  const { policy, assetType, assetId, usage } = input;
  const identity: Identity = { assetType, assetId, usage };

  // 主闸门关闭：不解析身份、不请求接口、不读快照、不算哈希。
  if (!policy.masterEnabled) return result(true, GATE_REASONS.allowedOpen, identity);

  // 策略从未成功拉取过：按「开」+ 拒绝处理，不把是否拿到快照当作放行依据。
  if (policy.failClosed === true) return result(false, GATE_REASONS.deniedPolicyUnavailable, identity);

  // 该类型子闸门关闭：该类完全不判定，同样不读取快照。
  if (policy.assetGates[assetType] !== true) return result(true, GATE_REASONS.allowedOpen, identity);

  const snapshot = input.snapshot;
  if (!snapshot) return result(false, GATE_REASONS.deniedNoSnapshot, identity);

  const now = input.now ?? Date.now();
  if (snapshotExpired(snapshot.staleAt, now)) {
    return result(false, GATE_REASONS.deniedExpired, identity, snapshot.revision);
  }

  // 写操作额外受 24 小时新鲜期约束：读/用沿用快照本身，只受 staleAt 约束。
  if (usage === 'write' && !snapshotFresh(snapshot.fetchedAt, now)) {
    return result(false, GATE_REASONS.deniedSnapshotStale, identity, snapshot.revision);
  }

  const entitled = snapshot.assets[assetType] ?? [];
  return entitled.includes(assetId)
    ? result(true, GATE_REASONS.allowedEntitled, identity, snapshot.revision)
    : result(false, GATE_REASONS.deniedNotEntitled, identity, snapshot.revision);
}
