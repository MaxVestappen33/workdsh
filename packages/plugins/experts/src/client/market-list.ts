import type { RemoteExpertApplyStatus, RemoteExpertListQuery, RemoteExpertScene, RemoteExpertSummary } from '../shared.js';

/** 市场每页条数：分页由服务端执行，界面滚动到接近底部再取下一页。 */
export const EXPERT_MARKET_PAGE_SIZE = 24;

/** 申请状态文案与后台 applyStatus 的对应关系；授权状态是另一个独立标签。 */
export const EXPERT_APPLY_LABEL: Record<RemoteExpertApplyStatus, string> = {
  none: '未申请', pending: '申请中', approved: '已通过', rejected: '未通过',
};
/** 申请状态筛选胶囊的顺序；点「全部」等价于不筛选。 */
export const EXPERT_APPLY_OPTIONS = ['未申请', '申请中', '已通过', '未通过'] as const;
export const EXPERT_APPLY_VALUE: Record<string, RemoteExpertApplyStatus> = {
  未申请: 'none', 申请中: 'pending', 已通过: 'approved', 未通过: 'rejected',
};
/** 是否内置筛选胶囊：与业务场景同款样式，单选，都不选即「全部」。 */
export const EXPERT_BUILTIN_OPTIONS = ['内置', '非内置'] as const;
/** 安装状态是本机台账判定，只在客户端过滤；授权/申请状态交给服务端。 */
export const EXPERT_INSTALL_OPTIONS = ['已安装', '未安装'] as const;
export const EXPERT_AUTH_OPTIONS = ['已授权', '未授权'] as const;

/** 市场筛选条件：业务场景与关键词、是否内置、授权状态、申请状态下发后台；安装状态只在客户端过滤。 */
export interface ExpertMarketFilter {
  readonly scenes: readonly string[];
  readonly keyword: string;
  readonly builtin?: boolean;
  readonly install?: 'installed' | 'uninstalled';
  readonly auth?: 'Y' | 'N';
  readonly apply?: RemoteExpertApplyStatus;
}

/** 界面侧的市场列表状态：逐页累积，`hasMore` 决定是否继续加载。 */
export interface ExpertMarketListState {
  readonly items: readonly RemoteExpertSummary[];
  readonly total: number;
  /** 已加载到的最新页码；尚未加载时为 0。 */
  readonly page: number;
  readonly hasMore: boolean;
}

export const emptyExpertMarketList: ExpertMarketListState = { items: [], total: 0, page: 0, hasMore: false };

/** 业务场景文案 → 后台 value；未命中字典的文案直接跳过，全部未命中时不下发筛选。 */
function sceneCodes(scenes: readonly string[], options: readonly RemoteExpertScene[]): readonly string[] {
  return scenes.flatMap(scene => {
    const value = options.find(item => item.label === scene)?.value;
    return value ? [value] : [];
  });
}

/**
 * 一页的请求参数：业务场景、关键词、是否内置、授权状态与申请状态都交给服务端，空值不下发。
 * 安装状态是本机判定，只在客户端过滤，因此不出现在请求参数里。
 */
export function expertMarketQuery(
  filter: ExpertMarketFilter,
  page: number,
  options: readonly RemoteExpertScene[],
  expertType: 'agent' | 'team',
): RemoteExpertListQuery {
  const scenes = sceneCodes(filter.scenes, options);
  const keyword = filter.keyword.trim();
  return {
    expertType,
    pageNo: page,
    pageSize: EXPERT_MARKET_PAGE_SIZE,
    ...(scenes.length ? { bizScene: scenes.join(',') } : {}),
    ...(keyword ? { keyword } : {}),
    ...(filter.builtin === undefined ? {} : { builtin: filter.builtin }),
    ...(filter.auth === undefined ? {} : { authStatus: filter.auth }),
    ...(filter.apply === undefined ? {} : { applyStatus: filter.apply }),
  };
}

/** 安装状态过滤：只做客户端判定，缺省返回原列表。 */
export function marketItemsByInstall(items: readonly RemoteExpertSummary[], install?: 'installed' | 'uninstalled'): readonly RemoteExpertSummary[] {
  if (install === undefined) return items;
  return items.filter(item => install === 'installed' ? item.installed !== undefined : item.installed === undefined);
}

/** 安装状态过滤下可见条目是否还不满一页：为真时需要继续向后补拉。 */
export function needsInstallFill(items: readonly RemoteExpertSummary[], install?: 'installed' | 'uninstalled'): boolean {
  return install !== undefined && marketItemsByInstall(items, install).length < EXPERT_MARKET_PAGE_SIZE;
}

/** 是否还有下一页：按后台原始分页判断，客户端过滤不影响翻页口径。 */
function hasMore(page: number, total: number): boolean {
  return page * EXPERT_MARKET_PAGE_SIZE < total;
}

/** 首屏或筛选变化：用新的一页替换已有列表。 */
export function startExpertMarketList(items: readonly RemoteExpertSummary[], total: number, page: number): ExpertMarketListState {
  return { items, total, page, hasMore: hasMore(page, total) };
}

/** 加载更多：把下一页追加到已有列表，按后台编号去重；后台已无下一页时视为到底。 */
export function appendExpertMarketList(
  state: ExpertMarketListState,
  items: readonly RemoteExpertSummary[],
  total: number,
  page: number,
): ExpertMarketListState {
  const seen = new Set(state.items.map(item => item.remoteId));
  const merged = [...state.items, ...items.filter(item => !seen.has(item.remoteId))];
  const mergedTotal = Math.max(state.total, total);
  return { items: merged, total: mergedTotal, page, hasMore: hasMore(page, mergedTotal) };
}
