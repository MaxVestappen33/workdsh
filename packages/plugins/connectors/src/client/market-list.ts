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

/** 当前生效的筛选条件：分类胶囊文案 + 搜索框关键词。 */
export interface MarketListFilter {
  readonly category: string;
  readonly keyword: string;
}

/** 分类文案 → 分类字典 value；「全部」或未命中字典时返回 undefined，表示不下发筛选。 */
export function marketSceneOf(category: string, dictionary: readonly MarketCategory[]): string | undefined {
  return dictionary.find(item => item.text === category)?.value;
}

/** 一页的请求参数：分类与关键词都交给服务端，空值不下发。切换筛选时以 page = 1 重新取数。 */
export function marketListQuery(filter: MarketListFilter, page: number, dictionary: readonly MarketCategory[]): MarketQuery {
  const scene = marketSceneOf(filter.category, dictionary);
  const keyword = filter.keyword.trim();
  return {
    page,
    pageSize: MARKET_PAGE_SIZE,
    ...(scene ? { scene } : {}),
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

/** 界面上的分类文案：多个分类用「 · 」分隔；一个都映射不出时返回空串，由界面决定不显示。 */
export function marketCategoryText(categories: readonly string[], dictionary: readonly MarketCategory[]): string {
  return marketCategoryLabels(categories, dictionary).join(' · ');
}
