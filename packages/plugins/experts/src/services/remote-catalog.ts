import { createHash } from 'node:crypto';
import type {
  MyListingListResult,
  MyListingQuery,
  MyListingSummary,
  RemoteExpertListQuery,
  RemoteExpertListResult,
  RemoteExpertPackage,
  RemoteExpertScene,
  RemoteExpertSummary,
  RemoteExpertType,
} from 'workdsh-contracts';
import { ExpertsError } from '../domain/values.js';
import { EXPERT_IMPORT_LIMITS } from './portability.js';

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
export const REMOTE_EXPERT_PATHS: Readonly<Record<RemoteExpertType, string>> = {
  agent: '/desktop-client/expert/queryAuthorizedExpertList',
  team: '/desktop-client/expertgroup/queryAuthorizedExpertGroupList',
};

/** Ledger of assets the current member submitted for review. */
export const MY_LISTING_PATHS: Readonly<Record<RemoteExpertType, string>> = {
  agent: '/desktop-client/expert/queryMyListingExpertList',
  team: '/desktop-client/expertgroup/queryMyListingExpertGroupList',
};

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

function toSummary(row: Record<string, unknown>, expertType: RemoteExpertType): RemoteExpertSummary | undefined {
  // `status`: 1 draft / 2 pending / 3 listed / 4 rejected / 5 withdrawn.
  const status = str(row.status);
  if (status !== undefined && status !== listedStatus) return undefined;
  if (count(row.delFlag) === 1) return undefined;
  const remoteId = str(row.id);
  const name = str(row.name);
  if (!remoteId || !name) return undefined;
  const pkg = packageOf(row);
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
  constructor(private readonly channel: () => BackendChannelLike | undefined) {}

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
      result = await channel.get(REMOTE_EXPERT_PATHS[expertType], {
        pageNo, pageSize, status: listedStatus,
        ...(query.keyword ? { keyword: query.keyword } : {}),
        ...(query.bizScene ? { bizScene: query.bizScene } : {}),
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
      result = await channel.get(MY_LISTING_PATHS[expertType], {
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
      result = await channel.get(REMOTE_EXPERT_PATHS[expertType], { id: remoteId, status: listedStatus, pageNo: 1, pageSize: 1 }, signal);
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
}
