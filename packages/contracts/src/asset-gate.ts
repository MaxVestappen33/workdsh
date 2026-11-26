/**
 * 资产闸门在界面侧的最小状态。
 *
 * 判定统一在客户端完成：拿到这份状态后，未开闸的资产类型一律把后台 `isAuthorized`
 * 当成 Y 处理（隐藏授权标签、申请入口与授权类筛选），服务端接口保持返回 Y/N 不变。
 */
export interface AssetGateClientState {
  /** 主闸门与该类型子闸门是否同时开启；false 表示该类不做授权判定。 */
  readonly enforced: boolean;
  /** 主闸门与验签开关是否同时开启。 */
  readonly signatureEnforced: boolean;
  /**
   * 策略从未成功拉取过、判定按最小权限拒绝（fail-closed）。
   * 与 `enforced=false` 互斥：此时仍会拦截写操作，但失败原因是「授权服务暂时不可用」。
   */
  readonly policyUnavailable: boolean;
}

/** 关闸时的统一取值：不做授权判定、不验签、不存在策略不可用。 */
export const ASSET_GATE_OPEN: AssetGateClientState = {
  enforced: false,
  signatureEnforced: false,
  policyUnavailable: false,
};
