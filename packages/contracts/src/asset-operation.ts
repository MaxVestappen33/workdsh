/**
 * 资产操作记录：客户端把安装、卸载等资产行为实时上报给后台（一次一条，不攒批、不落队列）。
 *
 * 接口路径、字段与失败码都由后台统一约定；技能市场与 MCP 市场共用这一份实现，
 * 保证 eventId、clientId 与 operationTime 的口径一致（时间格式与闸门审计共用同一个函数）。
 */
import { randomUUID } from 'node:crypto';

/** 资产操作记录接口：desktop-client 命名空间，Desktop 侧可经 ServerConfig 覆盖。 */
export const ASSET_OPERATION_REPORT_PATH = '/desktop-client/asset/operation/report';

/** 资产类型：与后台白名单一致，取值非法会被服务端以 invalidReason 拒绝。 */
export type AssetOperationAssetType = 'skill' | 'mcp' | 'expert' | 'expert_group' | 'model' | 'knowledge' | 'prompt';

export type AssetOperationType = 'install' | 'uninstall' | 'subscribe' | 'unsubscribe' | 'favorite' | 'unfavorite';

export type AssetOperationResult = 'success' | 'failed' | 'canceled';

/** 后台约定的失败大类码：failDetail 只放短说明，不能带本地路径、令牌或签名原文。 */
export type AssetOperationFailReason =
  | 'download_failed'
  | 'verify_failed'
  | 'signature_missing'
  | 'write_failed'
  | 'disk_check_failed'
  | 'manifest_failed'
  | 'dependency_missing'
  | 'network_failed'
  | 'permission_denied'
  | 'canceled_by_user'
  | 'other';

/** 一条上报事件：字段名与后台约定一致。 */
export interface AssetOperationEvent {
  readonly eventId: string;
  readonly assetType: AssetOperationAssetType;
  readonly assetId: string;
  readonly assetName: string;
  readonly operationType: AssetOperationType;
  readonly operationResult: AssetOperationResult;
  readonly failReason: AssetOperationFailReason | null;
  readonly failDetail: string | null;
  readonly clientId: string;
  readonly operationTime: string;
}

/** 上报入口参数：eventId 由流程开始时生成一次，同一流程的成功与失败上报复用它。 */
export interface AssetOperationInput {
  readonly eventId: string;
  readonly assetType: AssetOperationAssetType;
  readonly assetId: string;
  readonly assetName: string;
  readonly operationType: AssetOperationType;
  readonly operationResult: AssetOperationResult;
  readonly failReason?: AssetOperationFailReason;
  /** 失败短说明：写入前会去掉路径与长令牌，最长 120 字。 */
  readonly failDetail?: string;
}

/** 通用后台通道的最小面：上报只需要 POST。 */
export interface AssetOperationBackend {
  post<T = unknown>(path: string, body?: unknown, query?: URLSearchParams, signal?: AbortSignal): Promise<T>;
}

/** 上报结果：reported 为真表示后台已记账（duplicated 也算），为假时只记了日志。 */
export interface AssetOperationOutcome {
  readonly reported: boolean;
  readonly duplicated: boolean;
  /** 后台明确拒绝的原因（如 assetType 取值非法）；非空时不要重试同样的数据。 */
  readonly invalidReason?: string;
  /** 传输层失败说明，仅用于日志。 */
  readonly error?: string;
}

/** `2026-11-09 09:58:12`（本地时区，后台按客户端时间展示）。 */
export function formatClientTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 流程开始时的幂等标识：同一次安装/卸载流程（含重试）只生成一次。 */
export function assetOperationEventId(): string {
  return randomUUID();
}

/**
 * 客户端应用标识：取自载体配置的 `server.appId`（开发态 `workdsh-app.json`、打包态 `workdsh-config.json`），
 * 由 Desktop 经插件选项注入，不再使用设备实例标识。缺失时返回 undefined，上报器跳过本次记录。
 */
export function clientIdOf(appId: unknown): string | undefined {
  return typeof appId === 'string' && appId.trim() ? appId.trim() : undefined;
}

/**
 * 失败短说明的收敛：去掉文件 URL、绝对路径与长十六进制摘要，压成一行并截断。
 * 后台只把这个字段当排障线索，绝不能带出本机目录结构、令牌或签名原文。
 */
export function sanitizedFailDetail(value: unknown, limit = 120): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const cleaned = text
    .replace(/\bfile:\/\/\S+/giu, '[路径]')
    // POSIX 绝对路径、Windows 盘符路径与带两个以上分隔符的协议片段都按路径处理。
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s'"`，。；、]+){2,}/gu, '[路径]')
    // 32 位以上十六进制串只可能是摘要/签名，不进入说明。
    .replace(/\b[0-9a-f]{32,}\b/giu, '[摘要]')
    .replace(/\s+/gu, ' ')
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

/** 判断异常链里是否带权限类错误码：多用于把失败归类为 permission_denied。 */
export function isPermissionFailure(cause: unknown): boolean {
  let current: unknown = cause;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** 后台的 0/1 标志位可能是数字、字符串或布尔值，统一按「真」判定。 */
const truthy = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true';

export interface AssetOperationReporterOptions {
  readonly backend: AssetOperationBackend;
  /** 客户端应用标识（载体配置 `server.appId`）：缺失时跳过上报（后台要求非空）。 */
  readonly clientId: () => string | undefined;
  /** 接口路径：缺省用 ASSET_OPERATION_REPORT_PATH，Desktop 侧可覆盖。 */
  readonly path?: string;
  readonly warn: (message: string) => void;
  /** 便于测试注入时间。 */
  readonly now?: () => Date;
}

/**
 * 资产操作记录上报器：一次一条、实时发送。
 *
 * 上报失败只记日志并回传结果，不抛错、不重试、不落盘排队——调用方据此决定是否在界面上提示，
 * 但不得因为上报失败阻断本机已经完成的安装/卸载。
 */
export class AssetOperationReporter {
  constructor(private readonly options: AssetOperationReporterOptions) {}

  async report(input: AssetOperationInput): Promise<AssetOperationOutcome> {
    const clientId = this.options.clientId()?.trim();
    if (!clientId) {
      this.options.warn('资产操作记录：未配置客户端应用标识（server.appId），已跳过本次上报。');
      return { reported: false, duplicated: false };
    }
    const event: AssetOperationEvent = {
      eventId: input.eventId,
      assetType: input.assetType,
      assetId: input.assetId,
      assetName: input.assetName,
      operationType: input.operationType,
      operationResult: input.operationResult,
      failReason: input.failReason ?? null,
      failDetail: sanitizedFailDetail(input.failDetail),
      clientId,
      operationTime: formatClientTime((this.options.now ?? (() => new Date()))()),
    };
    try {
      const value = await this.options.backend.post(this.options.path?.trim() || ASSET_OPERATION_REPORT_PATH, event);
      // 后台可能直接返回结果对象，也可能包在 result 里；两种形态都按同一套字段解析。
      const body = recordOf(value)?.result;
      const result = recordOf(body) ?? recordOf(value);
      if (!result) return { reported: true, duplicated: false };
      const invalidReason = typeof result.invalidReason === 'string' ? result.invalidReason.trim() : '';
      const duplicated = truthy(result.duplicated);
      if (invalidReason) {
        this.options.warn(`资产操作记录：后台拒绝本条事件（${invalidReason}），不会重试。`);
        return { reported: false, duplicated, invalidReason };
      }
      // duplicated 也算后台已记账：同一 eventId 重复发送时不再报错。
      if (truthy(result.accepted) || duplicated) return { reported: true, duplicated };
      this.options.warn('资产操作记录：后台未接受本条事件。');
      return { reported: false, duplicated };
    } catch (cause) {
      const error = cause instanceof Error && cause.message ? cause.message : String(cause);
      this.options.warn(`资产操作记录：上报失败（${error}）。`);
      return { reported: false, duplicated: false, error };
    }
  }
}
