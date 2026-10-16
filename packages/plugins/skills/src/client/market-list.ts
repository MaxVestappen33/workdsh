import type { SkillMarketItem, SkillMarketPage, SkillMarketQuery, SkillScene } from '../market.js';

/** 市场每页条数：分页由服务端执行，界面滚动到接近底部再取下一页。 */
export const SKILL_MARKET_PAGE_SIZE = 24;

/** 界面侧的市场列表状态：逐页累积，`hasMore` 决定是否继续加载。 */
export interface SkillMarketListState {
  readonly items: readonly SkillMarketItem[];
  readonly total: number;
  /** 已加载到的最新页码；尚未加载时为 0。 */
  readonly page: number;
  readonly hasMore: boolean;
}

export const emptySkillMarketList: SkillMarketListState = { items: [], total: 0, page: 0, hasMore: false };

/** 当前生效的筛选条件：已选中的业务场景胶囊文案（多选，顺序即选择顺序）+ 搜索框关键词。 */
export interface SkillMarketFilter {
  readonly scenes: readonly string[];
  readonly keyword: string;
}

/** 业务场景文案 → 字典 value；未命中字典的值直接跳过，全部未命中时返回空数组，表示不下发筛选。 */
export function skillSceneCodes(scenes: readonly string[], dictionary: readonly SkillScene[]): readonly string[] {
  return scenes.flatMap(scene => {
    const value = dictionary.find(item => item.text === scene)?.value;
    return value ? [value] : [];
  });
}

/**
 * 一页的请求参数：业务场景与关键词都交给服务端，空值不下发。切换筛选时以 page = 1 重新取数。
 * 多选时把各业务场景 value 用英文逗号连接后下发为单个 `bizScene`（如 `a,b`），语义为命中任一。
 */
export function skillMarketQuery(filter: SkillMarketFilter, page: number, dictionary: readonly SkillScene[]): SkillMarketQuery {
  const scenes = skillSceneCodes(filter.scenes, dictionary);
  const keyword = filter.keyword.trim();
  return {
    page,
    pageSize: SKILL_MARKET_PAGE_SIZE,
    ...(scenes.length ? { scene: scenes.join(',') } : {}),
    ...(keyword ? { keyword } : {}),
  };
}

/** 首屏或筛选变化：用新的一页替换已有列表（回到该页，不保留旧结果）。 */
export function startSkillMarketList(page: SkillMarketPage): SkillMarketListState {
  return {
    items: page.items,
    total: page.total,
    page: page.page,
    hasMore: page.items.length > 0 && page.items.length < page.total,
  };
}

/** 加载更多：把下一页追加到已有列表，按技能 id 去重；返回的记录为空时视为到底。 */
export function appendSkillMarketList(state: SkillMarketListState, page: SkillMarketPage): SkillMarketListState {
  const seen = new Set(state.items.map(item => item.id));
  const items = [...state.items, ...page.items.filter(item => !seen.has(item.id))];
  const total = Math.max(state.total, page.total);
  return { items, total, page: page.page, hasMore: page.items.length > 0 && items.length < total };
}

/** 业务场景 value → 界面文案；无法映射的 value 直接跳过，不把原始编码显示给用户。 */
export function skillSceneNames(scenes: readonly string[], dictionary: readonly SkillScene[]): readonly string[] {
  return scenes.flatMap(code => {
    const label = dictionary.find(item => item.value === code)?.text;
    return label ? [label] : [];
  });
}

/**
 * 界面上的业务场景文案：后台下发的 bizSceneList 名称优先（多值全部展示），
 * 该字段缺失时才退回用字典把 bizScene 编码映射成名称；多个用「 · 」分隔。
 * 两种来源都映射不出时返回空串，由界面决定不显示，任何情况下都不展示原始编码。
 */
export function skillMarketSceneText(entry: SkillMarketItem, dictionary: readonly SkillScene[]): string {
  const labels = entry.sceneLabels.length ? entry.sceneLabels : skillSceneNames(entry.scenes, dictionary);
  return labels.join(' · ');
}
