/**
 * 资产闸门后台客户端。
 *
 * 只声明本插件需要的两个接口路径，其余（地址、请求头、信封、401 失效通知）全部交给
 * 宿主的通用后台通道。路径由 Desktop 从 app-config.ts 注入；未注入时使用内置默认值。
 */
import { AssetGateError } from './errors.js';
import { parseGatePolicy } from './policy.js';
import { parseSnapshotResult } from './snapshot.js';
import type { GatePolicy, SnapshotResult } from './types.js';

export interface AssetGatePaths {
  /** GET /desktop-client/asset/queryGatePolicy */
  readonly policy: string;
  /** GET /desktop-client/asset/queryEntitlementSnapshot */
  readonly snapshot: string;
  /** POST /desktop-client/asset/reportGateAudit */
  readonly report: string;
}

/** app-config.ts 未注入时的兜底路径；与后台已确认的接口一致。 */
export const DEFAULT_ASSET_GATE_PATHS: AssetGatePaths = {
  policy: '/desktop-client/asset/queryGatePolicy',
  snapshot: '/desktop-client/asset/queryEntitlementSnapshot',
  report: '/desktop-client/asset/reportGateAudit',
};

/** 宿主通用后台通道的最小依赖面。 */
export interface AssetGateChannel {
  available(): Promise<boolean>;
  get<T = unknown>(
    path: string,
    query?: Readonly<Record<string, string | number | undefined>>,
    signal?: AbortSignal,
  ): Promise<T>;
  post<T = unknown>(
    path: string,
    body?: unknown,
    query?: Readonly<Record<string, string | number | undefined>>,
    signal?: AbortSignal,
  ): Promise<T>;
}

export class AssetGateBackend {
  constructor(
    private readonly channel: () => AssetGateChannel | undefined,
    private readonly paths: AssetGatePaths,
  ) {}

  /** 通道缺失或没有登录绑定时为 false；调用方据此跳过一切请求。 */
  async available(): Promise<boolean> {
    const channel = this.channel();
    if (!channel) return false;
    try {
      return await channel.available();
    } catch {
      return false;
    }
  }

  async policy(signal?: AbortSignal): Promise<GatePolicy> {
    const value = await this.require().get<unknown>(this.paths.policy, undefined, signal);
    return parseGatePolicy(value);
  }

  /** revision 有值时后台命中会返回 { unchanged: true }，不返回全量授权。 */
  async snapshot(revision: string | undefined, signal?: AbortSignal): Promise<SnapshotResult> {
    const query = revision ? { revision } : undefined;
    const value = await this.require().get<unknown>(this.paths.snapshot, query, signal);
    return parseSnapshotResult(value);
  }

  /** 上报一批审计事件；整单失败（未登录/超限/网络）由通道直接抛出，交给调用方落盘重试。 */
  async reportGateAudit(body: { readonly clientVersion?: string; readonly events: readonly unknown[] }, signal?: AbortSignal): Promise<unknown> {
    return this.require().post<unknown>(this.paths.report, body, undefined, signal);
  }

  private require(): AssetGateChannel {
    const channel = this.channel();
    if (!channel) throw new AssetGateError('asset-gate/unavailable', '当前环境未接入资产闸门后台。');
    return channel;
  }
}
