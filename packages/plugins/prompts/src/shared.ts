/**
 * 授权提示词的公开契约：接口路径、列表条目与分页结果。
 * 路径由宿主（Desktop）从载体配置注入；Web 与未注入场景回退到与随包配置一致的内置默认值。
 */
export interface PromptPaths {
  /** 授权提示词列表（GET，query：keyword / pageNo / pageSize）。 */
  readonly list: string;
}

export interface PromptItem {
  readonly id: string;
  /** 提示词名称。 */
  readonly name: string;
  /** 提示词描述。 */
  readonly description: string;
  /** 提示词正文：点击后插入到会话输入框。 */
  readonly content: string;
}

export interface PromptPage {
  readonly items: readonly PromptItem[];
  /** 已取到的页码（后台 current）。 */
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /** 是否还有下一页：只由后台 pages 判定，避免按 total 猜测。 */
  readonly hasMore: boolean;
}

export interface PromptQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly keyword?: string;
}

export const DEFAULT_PROMPT_PATHS: PromptPaths = {
  list: '/desktop-client/prompt/queryAuthorizedPromptList',
};

/** 弹层每页条数：与后台默认分页一致，滚动到底再取下一页。 */
export const PROMPT_PAGE_SIZE = 10;

/** 提示词请求错误：网络、授权与后台拒绝各自有独立错误码，界面据此给出可读文案。 */
export class PromptRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PromptRequestError';
  }
}
