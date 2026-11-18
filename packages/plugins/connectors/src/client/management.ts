import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type { MarketCategory, MarketIndexItem, MarketPage, MarketQuery } from '../market.js';
import type { ConnectorConfigView, ConnectorInput, ConnectorInstallTask, ConnectorSummary, MarketInstallResult } from '../shared.js';

const path = '/api/workdsh-connectors';

/**
 * 授权申请菜单：与技能资产共用同一个后台菜单（同一单点登录入口地址、同一组参数）。
 * 资产类型不同只体现在 bizParams.assetType 上，因此这里按类型只维护参数，不复制菜单号。
 */
export const ASSET_APPLY_MENU_ID = '1990042000000000020';
/**
 * MCP 资产「申请 / 取消申请」的后台菜单与业务参数。
 *
 * 与技能授权申请完全相同，只有 `assetType` 固定为 `mcp`；`assetId` 由调用方按连接器记录的
 * `installManifest.assetId`（市场安装写入的后台编号）注入，界面不自行拼造编号。
 * menuId 保持可选：后台若下线该菜单，界面据此提示「跳转地址待配置」而不是发出无效请求。
 */
export const MCP_AUTH_SSO: Record<'apply' | 'cancel', { menuId?: string; bizParams: Record<string, string> }> = {
  apply: { menuId: ASSET_APPLY_MENU_ID, bizParams: { postLoginAction: 'assetApply', assetType: 'mcp' } },
  cancel: { menuId: ASSET_APPLY_MENU_ID, bizParams: { postLoginAction: 'assetApplyCancel', assetType: 'mcp' } },
};

/** 单点跳转结果：degraded 时只拿到纯登录地址，界面据此提示。 */
export interface ConnectorAdminSsoTarget {
  readonly url: string;
  readonly degraded: boolean;
}
/** 普通查询（列表、配置、分类）的超时：这些接口都是本机毫秒级响应。 */
const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * 会真正建立或断开 MCP 连接的操作超时：安装/卸载/启停/增改都要串联「后台上报 + 本机建连」，
 * 首次拉起 stdio 服务可能十几秒以上，用查询口径的 15 秒会把没失败的操作误报成超时。
 */
const CONNECT_TIMEOUT_MS = 60_000;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * fetch 自身抛出的异常（超时、取消、本机服务不可达）原文是英文 DOMException，
 * 直接显示不可读，这里统一归一为可直接展示的中文文案。
 */
function requestFailure(cause: unknown, timeoutMs: number, signal?: AbortSignal): Error {
  if (signal?.aborted) return new Error('请求已取消。');
  if (cause instanceof DOMException && cause.name === 'TimeoutError')
    return new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒），操作可能仍在后台执行，请刷新后确认结果。`);
  if (cause instanceof DOMException && cause.name === 'AbortError') return new Error('请求已取消。');
  return new Error('本地服务暂不可用，请稍后重试。');
}

async function invoke<T>(ctx: Context, endpoint: string, payload: unknown, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  void ctx;
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    throw requestFailure(cause, timeoutMs, signal);
  }
  const result = await response.json() as { ok?: boolean; value?: unknown; error?: unknown };
  if (!result.ok) {
    const error = isRecord(result.error) ? result.error : {};
    throw new Error(typeof error.message === 'string' ? error.message : '连接器操作失败，请重试。');
  }
  return result.value as T;
}

export function createConnectorManagementClient(ctx: Context, lifetime?: AbortSignal) {
  return {
    list: () => invoke<readonly ConnectorSummary[]>(ctx, 'list', {}, lifetime),
    config: (id: string) => invoke<ConnectorConfigView>(ctx, 'config', { id }, lifetime),
    create: (input: ConnectorInput) => invoke<ConnectorSummary>(ctx, 'create', input, lifetime, CONNECT_TIMEOUT_MS),
    update: (id: string, input: ConnectorInput) => invoke<ConnectorSummary>(ctx, 'update', { id, input }, lifetime, CONNECT_TIMEOUT_MS),
    remove: (id: string) => invoke<{ removed: true }>(ctx, 'remove', { id }, lifetime, CONNECT_TIMEOUT_MS),
    setEnabled: (id: string, enabled: boolean) => invoke<ConnectorSummary>(ctx, 'set-enabled', { id, enabled }, lifetime, CONNECT_TIMEOUT_MS),
    selection: (sessionId: string) => invoke<readonly string[]>(ctx, 'selection', { sessionId }, lifetime),
    setSelection: (sessionId: string, connectorIds: readonly string[]) => invoke<readonly string[]>(ctx, 'set-selection', { sessionId, connectorIds }, lifetime),
    marketAvailable: () => invoke<{ available: boolean }>(ctx, 'market-available', {}, lifetime),
    marketList: (input: MarketQuery) => invoke<MarketPage>(ctx, 'market-list', input, lifetime),
    marketCategories: () => invoke<readonly MarketCategory[]>(ctx, 'market-categories', {}, lifetime),
    /** 全量授权索引：本地 MCP 卡片按后台编号/市场标识匹配授权与申请状态。 */
    marketIndex: (refresh?: boolean) => invoke<readonly MarketIndexItem[]>(ctx, 'market-index', refresh === undefined ? {} : { refresh }, lifetime),
    /** 授权申请/取消申请的后台单点地址：菜单与业务参数由调用方给出。 */
    marketSso: (menuId: string, bizParams: Record<string, string>) => invoke<ConnectorAdminSsoTarget>(ctx, 'market-sso', { menuId, bizParams }, lifetime),
    marketInstall: (originId: string) => invoke<MarketInstallResult>(ctx, 'market-install', { originId }, lifetime, CONNECT_TIMEOUT_MS),
    /** 安装任务查询：需要下载依赖的条目在安装期间由界面轮询，直到 ready 或 failed。 */
    marketInstallStatus: (originId: string) => invoke<ConnectorInstallTask | null>(ctx, 'market-install-status', { originId }, lifetime),
    marketUninstall: (target: { originId?: string; id?: string }) => invoke<{ uninstalled: boolean; reported: boolean }>(ctx, 'market-uninstall', target, lifetime, CONNECT_TIMEOUT_MS),
  };
}
export type ConnectorManagementClient = ReturnType<typeof createConnectorManagementClient>;
