/**
 * 开关解析：后台策略 + 本机收紧项。
 *
 * 规则（方案文档 §五）：
 * - 生效值 = 后台策略 OR 本机收紧项；
 * - 本机只能把「关」改成「开」，不能关掉后台已开的子闸门；
 * - 打包默认全关，因此未拉到策略时生效值就是全关，不做任何额外请求。
 */
import { ASSET_TYPES, type AssetType, type EffectiveGatePolicy, type GatePolicy, type LocalGateConfig } from './types.js';
import { AssetGateError } from './errors.js';

/** 打包默认：全关。 */
export const DEFAULT_LOCAL_GATE_CONFIG: LocalGateConfig = {
  masterEnabled: false,
};

function allGates(value: boolean): Record<AssetType, boolean> {
  return Object.fromEntries(ASSET_TYPES.map(type => [type, value])) as Record<AssetType, boolean>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 后台策略归一化。缺字段按「关」处理（后台约定缺行即关）；
 * 完全无法识别的回包抛错，由调用方保留上一份策略，而不是静默全开。
 */
export function parseGatePolicy(value: unknown): GatePolicy {
  const record = asRecord(value);
  if (!record) throw new AssetGateError('asset-gate/response-invalid', '闸门策略回包无法识别。');
  const gates = asRecord(record.assetGates);
  const masterEnabled = record.masterEnabled === true;
  return {
    masterEnabled,
    assetGates: Object.fromEntries(
      ASSET_TYPES.map(type => [type, gates?.[type] === true]),
    ) as Record<AssetType, boolean>,
    // 旧版本后台或旧缓存没有该项时按主闸门值兜底：主闸门开则验签开，与后台缺行口径一致。
    assetSignature: gates?.assetSignature === undefined ? masterEnabled : gates.assetSignature === true,
    revision: asText(record.revision),
  };
}

/**
 * 从未成功拉取过任何策略时的 fail-closed 取值：主闸门与所有子闸门都按「开」处理。
 * 判定器看到 failClosed 会直接拒绝，不再依赖快照，避免屏蔽策略接口即可让闸门失效。
 */
export function failClosedPolicy(): EffectiveGatePolicy {
  return {
    masterEnabled: true,
    assetGates: allGates(true),
    assetSignature: true,
    revision: '',
    failClosed: true,
  };
}

/**
 * 计算生效闸门。policy 为 undefined 表示尚未拉到后台策略，
 * 此时只保留本机收紧项（打包默认全关）。
 */
export function resolveEffectivePolicy(
  policy: GatePolicy | undefined,
  local: LocalGateConfig = DEFAULT_LOCAL_GATE_CONFIG,
): EffectiveGatePolicy {
  const base = policy?.assetGates ?? allGates(false);
  const tightened = local.assetGates ?? {};
  // 缺字段（旧缓存/测试样本）按主闸门值兜底，与 parseGatePolicy 一致。
  const remoteSignature = policy === undefined
    ? false
    : policy.assetSignature === undefined ? policy.masterEnabled === true : policy.assetSignature === true;
  return {
    masterEnabled: policy?.masterEnabled === true || local.masterEnabled === true,
    assetGates: Object.fromEntries(
      ASSET_TYPES.map(type => [type, base[type] === true || tightened[type] === true]),
    ) as Record<AssetType, boolean>,
    // 本机只能收紧：后台关时本机可以打开，反之不生效。
    assetSignature: remoteSignature || local.assetSignature === true,
    revision: policy?.revision ?? '',
  };
}
