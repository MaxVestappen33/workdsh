import { createHash } from 'node:crypto';
import type {
  MyListingListResult,
  MyListingQuery,
  MyListingSummary,
  RemoteExpertApplyStatus,
  RemoteExpertListQuery,
  RemoteExpertListResult,
  RemoteExpertPackage,
  RemoteExpertScene,
  RemoteExpertSummary,
  RemoteExpertType,
} from 'workdsh-contracts';
import { ExpertsError } from '../domain/values.js';
import {
  ASSET_SIGNATURE_REASONS,
  AssetSignatureError,
  parseAssetSignatureEnvelope,
  type AssetSignatureEnvelope,
} from 'workdsh-asset-signature';
import { EXPERT_IMPORT_LIMITS } from './portability.js';
import { DEFAULT_EXPERT_API_PATHS, type ExpertApiPaths } from './endpoints.js';

/**
 * Backend expert catalog adapter (read-only).
 *
 * Paths and field mapping live here; request headers, the `{code,message,result}`
 * envelope and Chinese error passthrough stay in the shared `workdshBackend`
 * channel. The catalog itself is never persisted: only an explicit install writes
 * local expert records (see `ExpertsManager.installRemote`).
 */

/** Structural view of `workdshBackend` so this package needs no provider dependency. */
export interface BackendChannelLike {
  available(): Promise<boolean>;
  get<T = unknown>(path: string, query?: Readonly<Record<string, string | number | undefined>>, signal?: AbortSignal): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, query?: Readonly<Record<string, string | number | undefined>>, signal?: AbortSignal): Promise<T>;
  postForm<T = unknown>(path: string, form: FormData, signal?: AbortSignal, timeoutMs?: number): Promise<T>;
}

/** `AiClientController` list routes; the doc requires `status=3` to mean "listed". */
function marketPath(paths: ExpertApiPaths, expertType: RemoteExpertType): string {
  return expertType === 'team' ? paths.marketTeamList : paths.marketAgentList;
}

/** Ledger of assets the current member submitted for review. */
function listingPath(paths: ExpertApiPaths, expertType: RemoteExpertType): string {
  return expertType === 'team' ? paths.myListingTeam : paths.myListingAgent;
}

const LISTING_STATUS_LABELS: Readonly<Record<string, string>> = {
  '1': '草稿', '2': '待审批', '3': '已上架', '4': '已驳回', '5': '已下架',
};

const listedStatus = '3';
const downloadTimeoutMs = 60_000;
const sha256Hex = /^[a-f0-9]{64}$/i;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
const count = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Split the backend's comma-separated `tags` / `memberIds` without inventing entries. */
function splitList(value: unknown): string[] {
  const text = str(value);
  return text === undefined ? [] : text.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

/**
 * Extract the package attachment. `fjxxList` is documented as the attachment list;
 * older rows may also expose the attachment on the record itself, so both are read.
 * A digest is only accepted as sha256 (64 hex); an md5 column is ignored.
 */
function packageOf(row: Record<string, unknown>): RemoteExpertPackage | undefined {
  const candidates = [
    ...(Array.isArray(row.fjxxList) ? row.fjxxList : []),
    row.attachmentInfo,
  ];
  for (const candidate of candidates) {
    const item = record(candidate);
    if (!item) continue;
    const url = str(item.filePath) ?? str(item.fileUrl) ?? str(item.url);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const digestCandidate = str(item.sha256) ?? str(item.digest) ?? str(item.fileSha256);
    const digest = digestCandidate && sha256Hex.test(digestCandidate) ? digestCandidate.toLowerCase() : undefined;
    const bytes = count(item.fileSize) ?? count(item.size);
    return {
      fileName: str(item.fileName) ?? str(item.name) ?? 'expert-package.zip',
      url,
      ...(bytes === undefined ? {} : { bytes }),
      ...(digest === undefined ? {} : { digest }),
    };
  }
  return undefined;
}

/** `bizSceneList` entries become the scene filter options (parent scenes expanded by the backend). */
function scenesOf(row: Record<string, unknown>): RemoteExpertScene[] {
  const rows = Array.isArray(row.bizSceneList) ? row.bizSceneList : [];
  const scenes: RemoteExpertScene[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    const item = record(entry);
    const value = str(item?.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    scenes.push({ value, label: str(item?.label) ?? str(item?.text) ?? str(item?.title) ?? value });
  }
  return scenes;
}

/**
 * 后台布尔/标记字段的归一化：
 * - Java Integer 的 1/0（数字）与布尔 true/false 都要识别；
 * - 字符串形态（"1"/"0"、"true"/"false"、"Y"/"N"）一并兼容；
 * - 未知或缺省返回 undefined（界面据此不展示徽标）。
 */
function flagOf(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  const text = str(value)?.toLowerCase();
  if (text === '1' || text === 'true' || text === 'y') return true;
  if (text === '0' || text === 'false' || text === 'n') return false;
  return undefined;
}

/** isAuthorized 是后台的授权标记：只有明确为 Y/true 才算已授权，其余（含缺省）按未授权。 */
const authorizedOf = (value: unknown): boolean => flagOf(value) === true;

/** applyStatus：只接受四个已知取值，其它（含缺省）按 none（未申请）处理。 */
function applyStatusOf(value: unknown): RemoteExpertApplyStatus {
  const text = str(value)?.toLowerCase();
  return text === 'pending' || text === 'approved' || text === 'rejected' ? text : 'none';
}

/**
 * 后台签名可用状态：市场列表字段 `signatureAvailable`（布尔）与 `signatureReason`（字符串）。
 * 闸门关闭期间后台恒下发 true；开启后按「无附件 / 非 zip / 无签名记录」给 false + 原因。
 * 后台未下发该字段（旧版本）时返回 undefined，卡片不展示。
 */
function signatureStateOf(row: Record<string, unknown>): 'available' | 'unavailable' | undefined {
  const flag = flagOf(row.signatureAvailable);
  return flag === undefined ? undefined : flag ? 'available' : 'unavailable';
}

/**
 * `sourceNodeList` 是后台下发的来源节点数组（DictModel 形态：label / text / title / nodeName）。
 * 只取名称文案，去空去重并保持后台顺序；后台没有下发时退回 `sourceNode` 逗号串。
 */
function sourceNodesOf(row: Record<string, unknown>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    const label = value?.trim();
    if (!label || seen.has(label)) return;
    // 字典值（一长串编号）不是节点名：只显示后台给出的文案，避免把编号当来源节点展示。
    if (/^\d{6,}$/.test(label)) return;
    seen.add(label);
    names.push(label);
  };
  const dictText = str(row.sourceNodeList_dictText);
  // 字典多选字段通常另有 `_dictText` 文案列：优先取文案，避免把字典值（一串编号）当成节点名展示。
  if (dictText) for (const part of dictText.split(',')) add(part);
  if (!names.length && Array.isArray(row.sourceNodeList)) {
    for (const entry of row.sourceNodeList) {
      if (typeof entry === 'string') { add(entry); continue; }
      const item = record(entry);
      add(str(item?.label) ?? str(item?.text) ?? str(item?.title) ?? str(item?.nodeName) ?? str(item?.name) ?? str(item?.dictText) ?? str(item?.value));
    }
  }
  if (!names.length) {
    const fallback = str(row.sourceNode) ?? str(row.sourceNode_dictText);
    if (fallback) for (const part of fallback.split(',')) add(part);
  }
  return names;
}

function toSummary(row: Record<string, unknown>, expertType: RemoteExpertType): RemoteExpertSummary | undefined {
  // `status`: 1 draft / 2 pending / 3 listed / 4 rejected / 5 withdrawn.
  const status = str(row.status);
  if (status !== undefined && status !== listedStatus) return undefined;
  if (count(row.delFlag) === 1) return undefined;
  const remoteId = str(row.id);
  const name = str(row.name);
  if (!remoteId || !name) return undefined;
  const pkg = packageOf(row);
  const builtin = flagOf(row.builtin) ?? flagOf(row.isNzzc);
  const signatureState = signatureStateOf(row);
  const signatureReason = str(row.signatureReason);
  return {
    remoteId,
    expertType,
    name,
    description: str(row.description) ?? '',
    version: str(row.version) ?? 'v1.0.0',
    tags: splitList(row.tags),
    ...(str(row.icon) ? { icon: str(row.icon) } : {}),
    ...(str(row.color) ? { color: str(row.color) } : {}),
    ...(str(row.capability) ? { capability: str(row.capability) } : {}),
    ...(str(row.useCase) ? { useCase: str(row.useCase) } : {}),
    ...(str(row.domain) ? { domain: str(row.domain) } : {}),
    ...(str(row.domain_dictText) ? { domainLabel: str(row.domain_dictText) } : {}),
    ...(str(row.owner) ? { owner: str(row.owner) } : {}),
    ...(str(row.department) ? { department: str(row.department) } : {}),
    ...(count(row.subscribers) === undefined ? {} : { subscribers: count(row.subscribers) }),
    ...(count(row.downloadCount) === undefined ? {} : { downloadCount: count(row.downloadCount) }),
    ...(count(row.rating) === undefined ? {} : { rating: count(row.rating) }),
    memberIds: splitList(row.memberIds),
    scenes: scenesOf(row),
    ...(str(row.updateTime) ? { updatedAt: str(row.updateTime) } : {}),
    ...(pkg === undefined ? {} : { package: pkg }),
    // 是否内置 / 公开状态 / 来源节点 / 授权状态 / 申请状态：后台已下发但此前被丢弃。
    ...(builtin === undefined ? {} : { builtin }),
    ...(flagOf(row.isPublic) === undefined ? {} : { isPublic: flagOf(row.isPublic) }),
    sourceNodeList: sourceNodesOf(row),
    authorized: authorizedOf(row.isAuthorized),
    applyStatus: applyStatusOf(row.applyStatus),
    ...(signatureState === undefined ? {} : { signatureState }),
    ...(signatureReason === undefined ? {} : { signatureReason }),
  };
}

/** One row of the "my listing" ledger; status codes stay alongside a local label. */
function toMyListing(row: Record<string, unknown>, expertType: RemoteExpertType): MyListingSummary | undefined {
  if (count(row.delFlag) === 1) return undefined;
  const remoteId = str(row.id);
  const name = str(row.name);
  if (!remoteId || !name) return undefined;
  const status = str(row.status) ?? '';
  const pkg = packageOf(row);
  return {
    remoteId,
    expertType,
    name,
    description: str(row.description) ?? '',
    ...(str(row.capability) ? { capability: str(row.capability) } : {}),
    version: str(row.version) ?? 'v1.0.0',
    status,
    statusLabel: LISTING_STATUS_LABELS[status] ?? (status || '未知'),
    tags: splitList(row.tags),
    ...(str(row.domain) ? { domain: str(row.domain) } : {}),
    ...(str(row.owner) ? { owner: str(row.owner) } : {}),
    ...(str(row.department) ? { department: str(row.department) } : {}),
    ...(str(row.listingReason) ? { listingReason: str(row.listingReason) } : {}),
    ...(str(row.offlineReason) ? { offlineReason: str(row.offlineReason) } : {}),
    memberIds: splitList(row.memberIds),
    ...(str(row.updateTime) ? { updatedAt: str(row.updateTime) } : {}),
    ...(pkg === undefined ? {} : { package: pkg }),
  };
}

/** Normalize a channel error without leaking addresses or tokens. */
function remoteFailure(error: unknown): ExpertsError {
  if (error instanceof ExpertsError) return error;
  const candidate = error as { name?: string; code?: string; message?: string } | undefined;
  const backendCode = candidate?.name === 'BackendRequestError' ? candidate.code : undefined;
  if (backendCode === 'backend/unavailable') return new ExpertsError('experts/remote-unavailable', '当前环境未接入业务后台。', { reason: backendCode });
  if (backendCode === 'backend/unauthorized') return new ExpertsError('experts/remote-unavailable', candidate?.message ?? '登录已过期，请重新登录。', { reason: backendCode });
  if (backendCode === 'backend/unreachable') return new ExpertsError('experts/remote-unavailable', '无法连接业务后台，请检查网络后重试。', { reason: backendCode });
  if (backendCode === 'backend/rejected') return new ExpertsError('experts/remote-unavailable', candidate?.message ?? '业务后台拒绝了本次请求。', { reason: backendCode });
  return new ExpertsError('experts/remote-unavailable', candidate?.message ?? '读取后台专家目录失败。', {});
}

export class RemoteExpertCatalog {
  constructor(
    private readonly channel: () => BackendChannelLike | undefined,
    private readonly paths: ExpertApiPaths = DEFAULT_EXPERT_API_PATHS,
  ) {}

  private backend(): BackendChannelLike | undefined {
    return this.channel();
  }

  async available(): Promise<boolean> {
    const channel = this.backend();
    if (!channel) return false;
    try { return await channel.available(); } catch { return false; }
  }

  async list(query: RemoteExpertListQuery, signal?: AbortSignal): Promise<RemoteExpertListResult> {
    const expertType = query.expertType ?? 'agent';
    const pageNo = Math.max(1, Math.trunc(query.pageNo ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 24)));
    const channel = this.backend();
    if (!channel || !(await this.available())) {
      return {
        available: false,
        reason: '当前未接入业务后台（个人模式或未登录），暂不能读取专家目录。',
        items: [], pageNo, pageSize, total: 0, pages: 0,
      };
    }
    let result: unknown;
    try {
      result = await channel.get(marketPath(this.paths, expertType), {
        pageNo, pageSize, status: listedStatus,
        ...(query.keyword ? { keyword: query.keyword } : {}),
        ...(query.bizScene ? { bizScene: query.bizScene } : {}),
        // 是否内置与授权/申请状态都由后台筛选；安装状态由客户端按本机台账过滤，不下发。
        ...(query.builtin === undefined ? {} : { builtin: query.builtin ? '1' : '0' }),
        ...(query.authStatus ? { authStatus: query.authStatus } : {}),
        ...(query.applyStatus ? { applyStatus: query.applyStatus } : {}),
      }, signal);
    } catch (error) {
      throw remoteFailure(error);
    }
    const page = record(result) ?? {};
    const rows = Array.isArray(page.records) ? page.records : [];
    const items = rows
      .map(row => record(row))
      .filter((row): row is Record<string, unknown> => row !== undefined)
      .map(row => toSummary(row, expertType))
      .filter((row): row is RemoteExpertSummary => row !== undefined);
    const total = count(page.total) ?? items.length;
    const pages = count(page.pages) ?? (total === 0 ? 0 : Math.ceil(total / pageSize));
    return {
      available: true,
      items,
      pageNo: count(page.current) ?? pageNo,
      pageSize: count(page.size) ?? pageSize,
      total,
      pages,
    };
  }

  /**
   * Ledger of assets this member submitted for review. Unlike the market list, the
   * backend returns every status here and fills `fjxxList`, so no status filter is sent.
   */
  async myListings(query: MyListingQuery, signal?: AbortSignal): Promise<MyListingListResult> {
    const expertType = query.expertType ?? 'agent';
    const pageNo = Math.max(1, Math.trunc(query.pageNo ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 24)));
    const channel = this.backend();
    if (!channel || !(await this.available())) {
      return {
        available: false,
        reason: '当前未接入业务后台（个人模式或未登录），暂不能读取上架申请。',
        items: [], pageNo, pageSize, total: 0, pages: 0,
      };
    }
    let result: unknown;
    try {
      result = await channel.get(listingPath(this.paths, expertType), {
        pageNo, pageSize,
        ...(query.keyword ? { keyword: query.keyword } : {}),
      }, signal);
    } catch (error) {
      throw remoteFailure(error);
    }
    const page = record(result) ?? {};
    const rows = Array.isArray(page.records) ? page.records : [];
    const items = rows
      .map(row => record(row))
      .filter((row): row is Record<string, unknown> => row !== undefined)
      .map(row => toMyListing(row, expertType))
      .filter((row): row is MyListingSummary => row !== undefined);
    const total = count(page.total) ?? items.length;
    return {
      available: true,
      items,
      pageNo: count(page.current) ?? pageNo,
      pageSize: count(page.size) ?? pageSize,
      total,
      pages: count(page.pages) ?? (total === 0 ? 0 : Math.ceil(total / pageSize)),
    };
  }

  /**
   * Look up one listed row. The backend exposes no id route; `QueryGenerator`
   * accepts `id` as an exact-match entity field, so one row is requested directly
   * instead of paging the whole catalog.
   */
  async find(expertType: RemoteExpertType, remoteId: string, signal?: AbortSignal): Promise<RemoteExpertSummary | undefined> {
    const channel = this.backend();
    if (!channel || !(await this.available())) throw new ExpertsError('experts/remote-unavailable', '当前环境未接入业务后台。');
    let result: unknown;
    try {
      result = await channel.get(marketPath(this.paths, expertType), { id: remoteId, status: listedStatus, pageNo: 1, pageSize: 1 }, signal);
    } catch (error) {
      throw remoteFailure(error);
    }
    const page = record(result) ?? {};
    const rows = Array.isArray(page.records) ? page.records : [];
    for (const row of rows) {
      const item = record(row);
      if (!item) continue;
      const summary = toSummary(item, expertType);
      if (summary?.remoteId === remoteId) return summary;
    }
    return undefined;
  }

  /**
   * Download a catalog package. The URL must be absolute HTTP(S) (backend attachment
   * host); credentials never travel with it. Size is bounded before and while
   * reading, and a declared sha256 is verified before the archive reaches the
   * import pipeline.
   */
  async download(pkg: RemoteExpertPackage, signal?: AbortSignal): Promise<{ bytes: Uint8Array; digest: string }> {
    if (pkg.bytes !== undefined && pkg.bytes > EXPERT_IMPORT_LIMITS.maxZipBytes) {
      throw new ExpertsError('experts/install-package-missing', `专家包超过 ${EXPERT_IMPORT_LIMITS.maxZipBytes / (1024 * 1024)} MiB 上限。`);
    }
    let response: Response;
    try {
      response = await fetch(pkg.url, {
        redirect: 'follow',
        signal: AbortSignal.any([AbortSignal.timeout(downloadTimeoutMs), ...(signal ? [signal] : [])]),
      });
    } catch {
      throw new ExpertsError('experts/install-package-missing', '无法下载专家包，请检查网络或后台附件地址。', { fileName: pkg.fileName });
    }
    if (!response.ok || !response.body) {
      throw new ExpertsError('experts/install-package-missing', `下载专家包失败（HTTP ${response.status}）。`, { fileName: pkg.fileName });
    }
    const declared = count(response.headers.get('content-length'));
    if (declared !== undefined && declared > EXPERT_IMPORT_LIMITS.maxZipBytes) {
      throw new ExpertsError('experts/install-package-missing', `专家包超过 ${EXPERT_IMPORT_LIMITS.maxZipBytes / (1024 * 1024)} MiB 上限。`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > EXPERT_IMPORT_LIMITS.maxZipBytes) {
          throw new ExpertsError('experts/install-package-missing', `专家包超过 ${EXPERT_IMPORT_LIMITS.maxZipBytes / (1024 * 1024)} MiB 上限。`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (pkg.digest !== undefined && pkg.digest !== digest) {
      throw new ExpertsError('experts/install-digest-mismatch', '专家包校验失败（摘要不一致），已拒绝安装。', { fileName: pkg.fileName });
    }
    return { bytes, digest };
  }

  /**
   * 资产签名：按后台编号取签名 envelope。
   *
   * `assetType` 由专家形态决定（个人专家 `expert`、专家团 `expert_group`），
   * 响应里的 assetType/assetId 必须与请求一致，防止把别的资产签名搬过来。
   * 接口在类型不支持、资产不存在、无签名记录、签名为空、清单损坏时一律返回错误，
   * 不会下发空签名；调用方据此 fail closed，安装流程不落盘。
   */
  async signature(expertType: RemoteExpertType, assetId: string, signal?: AbortSignal): Promise<AssetSignatureEnvelope> {
    const id = str(assetId);
    if (!id) throw new ExpertsError(ASSET_SIGNATURE_REASONS.missing, '缺少专家标识，无法获取资产签名。');
    const expectedAssetType = expertType === 'team' ? 'expert_group' : 'expert';
    const channel = this.backend();
    if (!channel) throw new ExpertsError('experts/remote-unavailable', '当前环境未接入业务后台，无法获取资产签名。');
    let value: unknown;
    try {
      value = await channel.get(this.paths.signature, { assetType: expectedAssetType, assetId: id }, signal);
    } catch (error) {
      throw remoteFailure(error);
    }
    try {
      const envelope = parseAssetSignatureEnvelope(value);
      if (envelope.assetType !== expectedAssetType) {
        throw new ExpertsError(
          ASSET_SIGNATURE_REASONS.assetMismatch,
          `签名返回的资产类型是 ${envelope.assetType}，当前请求的是 ${expectedAssetType}。`,
        );
      }
      if (envelope.assetId !== id) {
        throw new ExpertsError(
          ASSET_SIGNATURE_REASONS.assetMismatch,
          `签名返回的资产编号是 ${envelope.assetId}，当前请求的是 ${id}。`,
        );
      }
      return envelope;
    } catch (error) {
      if (error instanceof ExpertsError) throw error;
      if (error instanceof AssetSignatureError) throw new ExpertsError(error.code, error.message);
      throw new ExpertsError(ASSET_SIGNATURE_REASONS.invalid, '资产签名返回的数据无法识别，已拒绝安装。');
    }
  }
}
