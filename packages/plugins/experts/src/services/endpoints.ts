/**
 * 专家相关后台接口路径。
 *
 * experts 是 Desktop/Web 共用的 Profile 包，不能自己去读载体配置：Desktop 从
 * `workdsh-app.json` 的 `server` 段读取后，以插件选项 `paths` 注入；Web 预览没有
 * 载体配置，使用这里的缺省值。缺省值与 Desktop 随包配置保持一致。
 *
 * 节点列表、字典、附件上传三个端点与技能上架共用同一批接口，Desktop 侧直接复用
 * `skillListingNodePath` / `skillDictPath` / `skillUploadPath` 注入。
 */
export interface ExpertApiPaths {
  /** 已授权专家目录（个人）。 */
  marketAgentList: string;
  /** 已授权专家团目录。 */
  marketTeamList: string;
  /** 我的上架申请（个人专家）。 */
  myListingAgent: string;
  /** 我的上架申请（专家团）。 */
  myListingTeam: string;
  /** 提交上架申请（个人专家）。 */
  submitAgent: string;
  /** 提交上架申请（专家团）。 */
  submitTeam: string;
  /** 撤回上架申请（个人专家）。 */
  withdrawAgent: string;
  /** 撤回上架申请（专家团）。 */
  withdrawTeam: string;
  /** 附件上传（图标与专家包）。 */
  upload: string;
  /** 来源节点列表。 */
  nodes: string;
  /** 字典前缀，实际请求为 `${dict}/${dictCode}`。 */
  dict: string;
}

/** 后台 desktop-client 命名空间的既有约定；未注入配置时使用。 */
export const DEFAULT_EXPERT_API_PATHS: ExpertApiPaths = {
  marketAgentList: '/desktop-client/expert/queryAuthorizedExpertList',
  marketTeamList: '/desktop-client/expertgroup/queryAuthorizedExpertGroupList',
  myListingAgent: '/desktop-client/expert/queryMyListingExpertList',
  myListingTeam: '/desktop-client/expertgroup/queryMyListingExpertGroupList',
  submitAgent: '/desktop-client/expert/listingRequest',
  submitTeam: '/desktop-client/expertgroup/listingRequest',
  withdrawAgent: '/desktop-client/expert/withdrawListingRequest',
  withdrawTeam: '/desktop-client/expertgroup/withdrawListingRequest',
  upload: '/desktop-client/upload',
  nodes: '/desktop-client/queryAiNodeList',
  dict: '/desktop-client/getDictItems',
};

/**
 * 合并注入值：只接受以单个 `/` 开头的相对路径，非法或缺省项回退到缺省值，
 * 避免一条配置错误把专家目录整体变成不可用。
 */
export function resolveExpertApiPaths(input?: Partial<ExpertApiPaths>): ExpertApiPaths {
  const output = { ...DEFAULT_EXPERT_API_PATHS };
  if (!input) return output;
  for (const key of Object.keys(DEFAULT_EXPERT_API_PATHS) as (keyof ExpertApiPaths)[]) {
    const value = input[key];
    if (typeof value === 'string' && /^\/(?!\/)/u.test(value.trim())) output[key] = value.trim();
  }
  return output;
}
