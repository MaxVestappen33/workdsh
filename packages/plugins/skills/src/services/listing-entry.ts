/**
 * 技能上架申请（后台审批流）在本插件内的宿主侧服务：
 * 提交申请、查询我的申请、取表单字典（技能类型 / 审批状态 / 来源节点 / 业务场景树）。
 *
 * 接口路径全部由宿主配置注入；地址拼接、请求头、信封解开与错误透传由通用后台通道负责。
 * 技能文件与图标都先经统一上传接口换成后台文件服务地址，再随申请一起提交。
 */
import { basename } from 'node:path';
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type {
  SkillListingItem, SkillListingOptions, SkillListingPage, SkillListingQuery, SkillListingRequest,
  SkillListingUpload, SkillNodeOption, SkillOption, SkillSceneNode,
} from '../shared.js';

/** 后台接口路径缺省值：与 Desktop 随包 workdsh-app.json 的 server 段保持一致。 */
const DEFAULT_LISTING_PATHS: SkillListingPaths = {
  submit: '/desktop-client/skill/listingRequest',
  list: '/desktop-client/skill/queryMyListingSkillList',
  nodes: '/desktop-client/queryAiNodeList',
  scenes: '/desktop-client/queryAiBizSceneList',
  dict: '/desktop-client/getDictItems',
  upload: '/desktop-client/upload',
};

/** 表单字典的字典编码：技能类型、审批状态与是否公开。 */
const SKILL_TYPE_DICT = 'skill_type';
const STATUS_DICT = 'ai_status';
const PUBLIC_DICT = 'yn';
/** 草稿不属于可申请的审批状态，下拉与徽标都不展示。 */
const DRAFT_STATUS = '1';
/** 上传接口的 biz 分区：技能文件与图标都落在 desktop-client/skill 下。 */
const UPLOAD_BIZ = 'desktop-client/skill';
/** 技能包上限与导入链路一致（50 MiB）；上传接口超时按大文件放宽。 */
const MAXIMUM_SKILL_BYTES = 50 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 180_000;
/** 来源节点分组顺序：与图二的「本级 / 上级 / 同级 / 下级」一致。 */
const NODE_TYPE_ORDER = ['self', 'up', 'peer', 'down'] as const;

export interface SkillListingPaths {
  readonly submit: string;
  readonly list: string;
  readonly nodes: string;
  readonly scenes: string;
  /** 通用字典前缀，实际请求为 `${dict}/${dictCode}`。 */
  readonly dict: string;
  readonly upload: string;
}

/** 通用后台通道在本插件用到的最小结构（结构化类型，避免跨包依赖）。 */
export interface SkillListingBackend {
  available(): Promise<boolean>;
  get<T = unknown>(path: string, query?: URLSearchParams, signal?: AbortSignal): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, query?: URLSearchParams, signal?: AbortSignal): Promise<T>;
  postForm<T = unknown>(path: string, form: FormData, signal?: AbortSignal, timeoutMs?: number): Promise<T>;
}

export interface SkillListingServiceOptions {
  readonly paths?: Partial<SkillListingPaths>;
}

/** 上架申请请求错误：code 为宿主侧错误码，message 为可直接展示的中文文案。 */
export class SkillListingRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SkillListingRequestError';
  }
}

export interface SkillListing {
  /** 后台通道可用时为 true；界面据此决定是否展示「我的申请」入口。 */
  available(): Promise<boolean>;
  /** 表单与状态下拉需要的全部字典，一次取回。 */
  options(signal?: AbortSignal): Promise<SkillListingOptions>;
  list(input?: SkillListingQuery, signal?: AbortSignal): Promise<SkillListingPage>;
  /** 提交上架申请：读取本地预检通过的暂存文件 → 上传后台 → 调申请接口。成功后丢弃暂存。 */
  submit(input: SkillListingRequest, signal?: AbortSignal): Promise<string>;
  /** 单文件上传（图标等）：返回后台文件地址与文件信息。 */
  upload(fileName: string, bytes: Uint8Array, signal?: AbortSignal): Promise<SkillListingUpload>;
}

declare module '@deepseek-ai/cordis' { interface Context { workdshSkillListing: SkillListing } }

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
/** 图标只接受 http(s) 地址；其它取值一律视为没有图标，由界面回退名称首字。 */
const iconOf = (value: unknown): string | undefined => {
  const icon = text(value);
  return icon && /^https?:\/\//iu.test(icon) ? icon : undefined;
};
/** 逗号分隔的多值字段：拆成去空、去重的数组。 */
const splitList = (value: unknown): readonly string[] => {
  const raw = text(value);
  if (!raw) return [];
  return [...new Set(raw.split(',').map(part => part.trim()).filter(Boolean))];
};
const dictLabelOf = (row: Record<string, unknown> | undefined): string | undefined =>
  text(row?.text) ?? text(row?.label) ?? text(row?.title);
const sortNoOf = (row: Record<string, unknown>): number =>
  typeof row.sortNo === 'number' && Number.isFinite(row.sortNo) ? row.sortNo : Number.MAX_SAFE_INTEGER;

const pathOf = (value: unknown, label: string): string => {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path.startsWith('/') || /[?#]/u.test(path))
    throw new SkillListingRequestError('skill/listing-unavailable', `技能上架申请${label}路径无效。`);
  return path;
};
const pathsOf = (value: SkillListingPaths): SkillListingPaths => ({
  submit: pathOf(value?.submit, '提交'),
  list: pathOf(value?.list, '列表'),
  nodes: pathOf(value?.nodes, '来源节点'),
  scenes: pathOf(value?.scenes, '业务场景'),
  dict: pathOf(value?.dict, '字典'),
  upload: pathOf(value?.upload, '上传'),
});

/**
 * 通用通道错误按 name + code 判定，而不是 instanceof：通道与服务可能在
 * Host 中解析到不同的模块实例，跨包 instanceof 不可靠。
 */
const backendCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || error.name !== 'BackendRequestError') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

/** 通用通道错误码 → 申请错误码与界面文案。 */
const listingError = (error: unknown): Error => {
  const code = backendCode(error);
  const message = error instanceof Error && error.message ? error.message : undefined;
  if (code === 'backend/rejected') return new SkillListingRequestError('skill/listing-rejected', message ?? '上架申请被后台拒绝。');
  if (code === 'backend/response-invalid') return new SkillListingRequestError('skill/listing-response-invalid', '上架申请服务返回的数据无法识别，请稍后重试。');
  if (code === 'backend/authority-invalid') return new SkillListingRequestError('skill/listing-authority-changed', '当前登录状态已变化，请重新登录后再试。');
  if (code === 'backend/unauthorized') return new SkillListingRequestError('skill/listing-unauthorized', message ?? '登录已过期，请重新登录。');
  if (code === 'backend/unreachable') return new SkillListingRequestError('skill/listing-unreachable', '无法连接业务后台，请检查网络后重试。');
  if (code === 'backend/address-invalid' || code === 'backend/path-invalid' || code === 'backend/unavailable')
    return new SkillListingRequestError('skill/listing-unavailable', '当前环境未接入技能上架申请服务。');
  if (error instanceof SkillListingRequestError) return error;
  return new SkillListingRequestError('skill/listing-unavailable', '无法连接技能上架申请服务，请检查网络后重试。');
};

/**
 * 上传响应里的文件地址。通用通道已经解出信封的 `result`，因此这里既接受纯字符串，
 * 也兼容后台把地址放在 `message` 或带前缀/反引号的文本（从中提取首个 http(s) 地址）。
 */
const uploadUrlOf = (value: unknown): string | undefined => {
  const box = record(value);
  for (const candidate of [value, box?.result, box?.message]) {
    if (typeof candidate !== 'string') continue;
    const match = candidate.match(/https?:\/\/[^\s`]+/u);
    if (match) return match[0];
  }
  return undefined;
};

/** 附件 MIME：上传接口按扩展名保存文件，这里给出与之一致的类型。 */
const mimeOf = (fileName: string): string => {
  const name = fileName.toLowerCase();
  if (name.endsWith('.zip')) return 'application/zip';
  if (name.endsWith('.md')) return 'text/markdown';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
};

/** 业务场景树：children 递归归一化，同级按 sortNo 排序。 */
const sceneTreeOf = (value: unknown): readonly SkillSceneNode[] => {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap(entry => {
      const row = record(entry);
      const id = text(row?.id);
      const name = text(row?.name);
      if (!row || !id || !name) return [];
      return [{ row, node: { value: id, label: name, children: sceneTreeOf(row.children) } }];
    })
    .sort((left, right) => sortNoOf(left.row) - sortNoOf(right.row))
    .map(item => item.node);
};

const optionOf = (value: unknown): SkillOption | undefined => {
  const row = record(value); if (!row) return undefined;
  const optionValue = text(row.value); const label = dictLabelOf(row);
  return optionValue && label ? { value: optionValue, label } : undefined;
};

const nodeOf = (value: unknown): SkillNodeOption | undefined => {
  const row = record(value); if (!row) return undefined;
  const nodeValue = text(row.value); const label = text(row.label);
  if (!nodeValue || !label) return undefined;
  return { value: nodeValue, label, nodeType: text(row.nodeType) ?? 'self' };
};

const fileOf = (value: unknown): { fileName: string; filePath: string; size?: number } | undefined => {
  const row = record(value); if (!row) return undefined;
  const filePath = text(row.filePath); if (!filePath) return undefined;
  const fileName = text(row.fileName) ?? basename(filePath);
  const rawSize = typeof row.fileSize === 'string' ? Number(row.fileSize) : row.fileSize;
  const size = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize > 0 ? Math.trunc(rawSize) : undefined;
  return { fileName, filePath, ...(size === undefined ? {} : { size }) };
};

/** 一条申请记录：缺少 id 或名称时跳过，避免整页失败。 */
const itemOf = (value: unknown): SkillListingItem | undefined => {
  const row = record(value); if (!row) return undefined;
  const id = text(row.id); const title = text(row.skillName);
  if (!id || !title) return undefined;
  const sceneLabels = Array.isArray(row.bizSceneList)
    ? [...new Set(row.bizSceneList.flatMap(entry => { const label = dictLabelOf(record(entry)); return label ? [label] : []; }))]
    : [];
  const files = Array.isArray(row.fjxxList) ? row.fjxxList.flatMap(entry => { const file = fileOf(entry); return file ? [file] : []; }) : [];
  const tags = splitList(row.customTag);
  return {
    id,
    title,
    slug: text(row.skillNameEn) ?? title,
    description: text(row.skillDescr) ?? '',
    ...(text(row.skillVersion) ? { version: text(row.skillVersion) } : {}),
    ...(iconOf(row.icon) ? { icon: iconOf(row.icon) } : {}),
    ...(text(row.color) ? { color: text(row.color) } : {}),
    scenes: splitList(row.bizScene),
    sceneLabels,
    ...(text(row.skillType) ? { skillType: text(row.skillType) } : {}),
    ...(text(row.skillType_dictText) ? { skillTypeText: text(row.skillType_dictText) } : {}),
    tags,
    status: text(row.status) ?? '',
    ...(text(row.status_dictText) ? { statusText: text(row.status_dictText) } : {}),
    ...(text(row.listingReason) ? { reason: text(row.listingReason) } : {}),
    ...(text(row.sourceNode) ? { sourceNode: text(row.sourceNode) } : {}),
    ...(text(row.sourceNode_dictText) ? { sourceNodeText: text(row.sourceNode_dictText) } : {}),
    ...(text(row.createTime) ? { createdAt: text(row.createTime) } : {}),
    ...(text(row.comments) ? { comments: text(row.comments) } : {}),
    files,
  };
};

/** 宿主侧上架申请服务：只声明路径与字段映射，请求头与信封由通用通道负责。 */
export class SkillListingService extends Service implements SkillListing {
  private readonly paths: SkillListingPaths;

  constructor(ctx: Context, options: SkillListingServiceOptions = {}) {
    super(ctx, 'workdshSkillListing');
    const paths = options.paths ?? {};
    this.paths = pathsOf({
      submit: paths.submit?.trim() || DEFAULT_LISTING_PATHS.submit,
      list: paths.list?.trim() || DEFAULT_LISTING_PATHS.list,
      nodes: paths.nodes?.trim() || DEFAULT_LISTING_PATHS.nodes,
      scenes: paths.scenes?.trim() || DEFAULT_LISTING_PATHS.scenes,
      dict: paths.dict?.trim() || DEFAULT_LISTING_PATHS.dict,
      upload: paths.upload?.trim() || DEFAULT_LISTING_PATHS.upload,
    });
  }

  async available(): Promise<boolean> {
    const channel = this.channel();
    if (!channel) return false;
    try { return await channel.available(); } catch { return false; }
  }

  async options(signal?: AbortSignal): Promise<SkillListingOptions> {
    const [skillTypes, statuses, publicItems, nodes, scenes] = await Promise.all([
      this.dict(SKILL_TYPE_DICT, signal),
      this.dict(STATUS_DICT, signal),
      this.dict(PUBLIC_DICT, signal),
      this.request('GET', this.paths.nodes, undefined, undefined, signal),
      this.request('GET', this.paths.scenes, undefined, undefined, signal),
    ]);
    const order = new Map<string, number>(NODE_TYPE_ORDER.map((type, index): [string, number] => [type, index]));
    return {
      skillTypes: skillTypes.flatMap(entry => { const option = optionOf(entry); return option ? [option] : []; }),
      // 草稿不在审批流里，下拉与徽标都不展示。
      statuses: statuses.flatMap(entry => {
        const option = optionOf(entry);
        return option && option.value !== DRAFT_STATUS ? [option] : [];
      }),
      publicOptions: publicItems.flatMap(entry => { const option = optionOf(entry); return option ? [option] : []; }),
      nodes: (Array.isArray(nodes) ? nodes : [])
        .flatMap(entry => { const node = nodeOf(entry); return node ? [node] : []; })
        .map((node, index) => ({ node, index }))
        .sort((left, right) => (order.get(left.node.nodeType) ?? NODE_TYPE_ORDER.length) - (order.get(right.node.nodeType) ?? NODE_TYPE_ORDER.length) || left.index - right.index)
        .map(item => item.node),
      scenes: sceneTreeOf(scenes),
    };
  }

  async list(input: SkillListingQuery = {}, signal?: AbortSignal): Promise<SkillListingPage> {
    const page = input.page && input.page > 0 ? Math.trunc(input.page) : 1;
    const query = new URLSearchParams({
      pageNo: String(page),
      pageSize: String(input.pageSize && input.pageSize > 0 ? Math.trunc(input.pageSize) : 24),
      _t: String(Date.now()),
    });
    const keyword = text(input.keyword); if (keyword) query.set('keyword', keyword);
    const status = text(input.status); if (status) query.set('status', status);
    const result = record(await this.request('GET', this.paths.list, query, undefined, signal));
    if (!result || !Array.isArray(result.records))
      throw new SkillListingRequestError('skill/listing-response-invalid', '我的申请列表返回的数据无法识别，请稍后重试。');
    const items = result.records.flatMap(entry => { const item = itemOf(entry); return item ? [item] : []; });
    const total = typeof result.total === 'number' ? count(result.total) : items.length;
    const current = typeof result.current === 'number' && result.current > 0 ? Math.trunc(result.current) : page;
    return { items, total, page: current };
  }

  async submit(input: SkillListingRequest, signal?: AbortSignal): Promise<string> {
    const skillName = text(input.skillName);
    const skillNameEn = text(input.skillNameEn);
    if (!skillName || !skillNameEn) throw new SkillListingRequestError('skill/listing-invalid-request', '技能名称与英文名称不能为空。');
    const manager = this.ctx.workdshSkills;
    // 提交前再次复核暂存指纹：文件被替换或过期时直接失败，不把不一致的包送进审批流。
    const staged = await manager.imports.read(input.stagedId);
    const upload = await this.upload(staged.fileName, staged.bytes, signal);
    const body = {
      skillName,
      skillNameEn,
      skillVersion: text(input.skillVersion) ?? '',
      skillType: text(input.skillType) ?? '',
      bizScene: input.bizScene,
      sourceNode: text(input.sourceNode) ?? '',
      skillDescr: input.skillDescr,
      customTag: input.customTag,
      reason: input.reason,
      isPublic: text(input.isPublic) ?? '',
      ...(text(input.icon) ? { icon: text(input.icon) } : {}),
      skillFileInfo: { fileName: upload.fileName, filePath: upload.url, fileSize: String(upload.size) },
    };
    const result = await this.request('POST', this.paths.submit, undefined, body, signal);
    // 申请已进审批流：暂存清理失败不影响提交结果，交给下次预检时的过期回收。
    await manager.imports.discard(input.stagedId).catch(() => {});
    return text(result) ?? (text(record(result)?.message) ?? '技能上架申请已提交。');
  }

  async upload(fileName: string, bytes: Uint8Array, signal?: AbortSignal): Promise<SkillListingUpload> {
    const safeName = basename(fileName.trim());
    if (!safeName) throw new SkillListingRequestError('skill/listing-invalid-request', '上传文件缺少文件名。');
    if (!bytes.byteLength) throw new SkillListingRequestError('skill/listing-upload-empty', '上传的文件为空。');
    if (bytes.byteLength > MAXIMUM_SKILL_BYTES) throw new SkillListingRequestError('skill/listing-upload-too-large', '文件不得超过 50 MiB。');
    const channel = this.channel_();
    const form = new FormData();
    form.append('biz', UPLOAD_BIZ);
    form.append('file', new Blob([bytes.slice()], { type: mimeOf(safeName) }), safeName);
    const raw = await channel.postForm(this.paths.upload, form, signal, UPLOAD_TIMEOUT_MS);
    const url = uploadUrlOf(raw);
    if (!url) throw new SkillListingRequestError('skill/listing-upload-failed', '上传接口未返回可用的文件地址，请重试。');
    return { url, fileName: safeName, size: bytes.byteLength };
  }

  /** 通用字典：后台按 `{dictCode}` 路径参数下发选项。 */
  private async dict(code: string, signal?: AbortSignal): Promise<readonly unknown[]> {
    const result = await this.request('GET', `${this.paths.dict.replace(/\/+$/u, '')}/${code}`, undefined, undefined, signal);
    if (!Array.isArray(result))
      throw new SkillListingRequestError('skill/listing-response-invalid', '技能字典返回的数据无法识别，请稍后重试。');
    return result;
  }

  private async request(method: 'GET' | 'POST', path: string, query: URLSearchParams | undefined, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const channel = this.channel_();
    try {
      return method === 'GET'
        ? await channel.get(path, query, signal)
        : await channel.post(path, body, query, signal);
    } catch (error) {
      throw listingError(error);
    }
  }

  /** 通用后台通道是可选注入的宿主能力：缺失时整条申请链路不可用，插件本身照常加载。 */
  private channel(): SkillListingBackend | undefined {
    return this.ctx.reflect.get('workdshBackend') as SkillListingBackend | undefined;
  }

  private channel_(): SkillListingBackend {
    const channel = this.channel();
    if (!channel || typeof channel.postForm !== 'function')
      throw new SkillListingRequestError('skill/listing-unavailable', '当前环境未接入技能上架申请服务。');
    return channel;
  }
}
