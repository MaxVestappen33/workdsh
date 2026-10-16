import type { MarketCategory, MarketItem, MarketPage, MarketQuery } from '../market.js';

/** 市场每页条数：分页由服务端执行，界面滚动到接近底部再取下一页。 */
export const MARKET_PAGE_SIZE = 24;

/** 界面侧的市场列表状态：逐页累积，`hasMore` 决定是否继续加载。 */
export interface MarketListState {
  readonly items: readonly MarketItem[];
  readonly total: number;
  /** 已加载到的最新页码；尚未加载时为 0。 */
  readonly page: number;
  readonly hasMore: boolean;
}

export const emptyMarketList: MarketListState = { items: [], total: 0, page: 0, hasMore: false };

/** 当前生效的筛选条件：已选中的分类胶囊文案（多选，顺序即选择顺序）+ 搜索框关键词。 */
export interface MarketListFilter {
  readonly categories: readonly string[];
  readonly keyword: string;
}

/** 分类文案 → 分类字典 value；未命中字典的值直接跳过，全部未命中时返回空数组，表示不下发筛选。 */
export function marketSceneOf(categories: readonly string[], dictionary: readonly MarketCategory[]): readonly string[] {
  return categories.flatMap(category => {
    const value = dictionary.find(item => item.text === category)?.value;
    return value ? [value] : [];
  });
}

/**
 * 一页的请求参数：分类与关键词都交给服务端，空值不下发。切换筛选时以 page = 1 重新取数。
 * 多选时把各分类 value 用英文逗号连接后下发为单个 `bizScene`（如 `a,b`），语义为命中任一；
 * 单选时下发结果与旧契约完全一致（如 `a`）。
 */
export function marketListQuery(filter: MarketListFilter, page: number, dictionary: readonly MarketCategory[]): MarketQuery {
  const scenes = marketSceneOf(filter.categories, dictionary);
  const keyword = filter.keyword.trim();
  return {
    page,
    pageSize: MARKET_PAGE_SIZE,
    ...(scenes.length ? { scene: scenes.join(',') } : {}),
    ...(keyword ? { keyword } : {}),
  };
}

/** 首屏或筛选变化：用新的一页替换已有列表（回到该页，不保留旧结果）。 */
export function startMarketList(page: MarketPage): MarketListState {
  return {
    items: page.items,
    total: page.total,
    page: page.page,
    hasMore: page.items.length > 0 && page.items.length < page.total,
  };
}

/** 加载更多：把下一页追加到已有列表，按 originId 去重；返回的记录为空时视为到底。 */
export function appendMarketList(state: MarketListState, page: MarketPage): MarketListState {
  const seen = new Set(state.items.map(item => item.originId));
  const items = [...state.items, ...page.items.filter(item => !seen.has(item.originId))];
  const total = Math.max(state.total, page.total);
  return { items, total, page: page.page, hasMore: page.items.length > 0 && items.length < total };
}

/** 分类字典 value → 界面文案；无法映射的 value 直接跳过，不把原始编码显示给用户。 */
export function marketCategoryLabels(categories: readonly string[], dictionary: readonly MarketCategory[]): readonly string[] {
  return categories.flatMap(code => {
    const label = dictionary.find(item => item.value === code)?.text;
    return label ? [label] : [];
  });
}

/**
 * 界面上的分类文案：后台下发的 bizSceneList 名称优先（多值全部展示），
 * 该字段缺失时才退回用分类字典把 bizScene 编码映射成名称；多个用「 · 」分隔。
 * 两种来源都映射不出时返回空串，由界面决定不显示，任何情况下都不展示原始编码。
 */
export function marketCategoryText(entry: MarketItem, dictionary: readonly MarketCategory[]): string {
  const labels = entry.categoryLabels.length ? entry.categoryLabels : marketCategoryLabels(entry.categories, dictionary);
  return labels.join(' · ');
}
