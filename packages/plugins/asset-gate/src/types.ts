/**
 * 资产闸门骨架的公共类型与常量。
 *
 * 契约来源：docs/asset-gate-design.md 与后台已上线的两个接口：
 * - GET /desktop-client/asset/queryGatePolicy
 * - GET /desktop-client/asset/queryEntitlementSnapshot
 *
 * 本文件只描述「能确认的字段」，不编造后台未下发的数据。
 */
import type { GateReasonCode } from './reasons.js';

/** 后台策略与授权快照使用的七类资产键。 */
export const ASSET_TYPES = ['skill', 'mcp', 'expert', 'expert_group', 'model', 'knowledge', 'prompt'] as const;

export type AssetType = typeof ASSET_TYPES[number];

/**
 * 客户端实际判定的六类。knowledge 仍会被解析进策略与快照（后台按七类返回），
 * 但本期不参与判定——方案文档已明确知识库不参与客户端闸门。
 */
export const GATE_ASSET_TYPES = ['skill', 'mcp', 'expert', 'expert_group', 'model', 'prompt'] as const;

export type GateAssetType = typeof GATE_ASSET_TYPES[number];

/** 资产用途：读清单、实际使用、写操作。本期三者判定口径一致。 */
export type AssetUsage = 'read' | 'use' | 'write';

/** 后台下发的闸门策略（已归一化）。 */
export interface GatePolicy {
  readonly masterEnabled: boolean;
  readonly assetGates: Readonly<Record<AssetType, boolean>>;
  /**
   * 资产验签总开关（后台 `assetGates.assetSignature`，库字段 `asset_signature`）。
   * 旧版本缓存可能没有该字段：解析与解析前的兜底都按主闸门值处理，与后台下发口径一致。
   */
  readonly assetSignature?: boolean;
  /** 后台修订号；空串表示后台未提供。 */
  readonly revision: string;
}

/**
 * 本机收紧项。后台是下限，本机只能把「关」改成「开」：
 * 这里只认 true，false 与缺失一律不生效。
 */
export interface LocalGateConfig {
  readonly masterEnabled?: boolean;
  readonly assetGates?: Readonly<Partial<Record<AssetType, boolean>>>;
  /** 本机单独收紧验签开关；不能关掉后台已开的验签。 */
  readonly assetSignature?: boolean;
}

/** 生效闸门：后台策略 OR 本机收紧项。 */
export interface EffectiveGatePolicy {
  readonly masterEnabled: boolean;
  readonly assetGates: Readonly<Record<AssetType, boolean>>;
  /** 验签开关的生效值；主闸门关闭时它不产生任何效果（调用方只看 signatureEnabled）。 */
  readonly assetSignature: boolean;
  readonly revision: string;
  /**
   * 后台绑定可用、却从未成功拉取过任何策略：按「开」+ 拒绝处理（fail-closed）。
   * 此时不依赖快照，直接拒绝，避免靠挡住策略接口让闸门失效。
   */
  readonly failClosed?: boolean;
}

/** 一次授权快照的本地记录（后台字段 + 本地归属信息）。 */
export interface SnapshotRecord {
  /** 本地账号键（组织 + 主体），不来自后台，用于隔离缓存。 */
  readonly accountKey: string;
  /** 后台修订号，用于之后按 revision 比对。 */
  readonly revision: string;
  /** 快照生成时间（后台字段，可能缺失）。 */
  readonly generatedAt?: string;
  /** 授权最晚结束时间；空值表示后台未给出时限。 */
  readonly staleAt?: string | null;
  /** 七类资产各自被授权的资产 id。 */
  readonly assets: Readonly<Record<AssetType, readonly string[]>>;
  /** 本地抓取时间，仅用于诊断。 */
  readonly fetchedAt: string;
}

/** 快照接口的两种回包。 */
export type SnapshotResult =
  | { readonly unchanged: true; readonly revision: string }
  | {
    readonly unchanged: false;
    readonly revision: string;
    readonly generatedAt?: string;
    readonly staleAt?: string | null;
    readonly assets: Readonly<Record<AssetType, readonly string[]>>;
  };

/** 判定结果。 */
export interface GateDecision {
  readonly allow: boolean;
  /** 稳定原因码；文案统一从 GATE_REASON_MESSAGES 取。 */
  readonly reason: GateReasonCode;
  /** 与原因码对应的可读文案，供 UI 直接展示，避免各处再维护一份映射。 */
  readonly message: string;
  readonly assetType: GateAssetType;
  readonly assetId: string;
  readonly usage: AssetUsage;
  /** 判定所依据的快照修订号；未读到快照时为空。 */
  readonly snapshotRevision?: string;
}

/** 判定器输入。now 显式传入，保证纯函数可复现。 */
export interface DecisionInput {
  readonly policy: EffectiveGatePolicy;
  readonly snapshot?: SnapshotRecord;
  readonly assetType: GateAssetType;
  readonly assetId: string;
  readonly usage: AssetUsage;
  /** 毫秒时间戳；缺省取 Date.now()，测试必须显式传入。 */
  readonly now?: number;
}
