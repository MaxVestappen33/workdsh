import type { SkillListingPage } from '../shared.js';

/** 我的申请每页条数：分页由服务端执行，界面滚动到接近底部再取下一页。 */
export const SKILL_LISTING_PAGE_SIZE = 24;

/** 界面侧的申请列表状态：逐页累积，`hasMore` 决定是否继续加载。 */
export interface SkillListingListState {
  readonly items: SkillListingPage['items'];
  readonly total: number;
  /** 已加载到的最新页码；尚未加载时为 0。 */
  readonly page: number;
  readonly hasMore: boolean;
}

export const emptySkillListingList: SkillListingListState = { items: [], total: 0, page: 0, hasMore: false };

/** 首屏或筛选变化：用新的一页替换已有列表。 */
export function startSkillListingList(page: SkillListingPage): SkillListingListState {
  return {
    items: page.items,
    total: page.total,
    page: page.page,
    hasMore: page.items.length > 0 && page.items.length < page.total,
  };
}

/** 加载更多：把下一页追加到已有列表，按申请单 id 去重；返回的记录为空时视为到底。 */
export function appendSkillListingList(state: SkillListingListState, page: SkillListingPage): SkillListingListState {
  const seen = new Set(state.items.map(item => item.id));
  const items = [...state.items, ...page.items.filter(item => !seen.has(item.id))];
  const total = Math.max(state.total, page.total);
  return { items, total, page: page.page, hasMore: page.items.length > 0 && items.length < total };
}
