import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { SkillMarketAuthorized, SkillMarketDocument, SkillMarketInstallResult, SkillMarketPage, SkillMarketQuery, SkillScene } from '../market.js';
import type { ManagedSkillDetail, ManagedSkillResource, ManagedSkillSummary, SkillBatchAction, SkillBatchResult, SkillCatalogSummary, SkillDependencyImpact, SkillInstallScope, SkillMutationReceipt, SkillResourceWriteRequest, SkillWriteRequest, StagedSkillImport, TrashedSkillSummary } from '../shared.js';

const path = '/api/workdsh-skills';

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function failure(value: unknown): Error {
  if (isRecord(value) && typeof value.message === 'string') return Object.assign(new Error(value.message), { code: typeof value.code === 'string' ? value.code : 'skill/request-failed' });
  return new Error('技能操作失败，请重试。');
}

function transportFailure(cause: unknown): Error {
  if (cause instanceof DOMException && cause.name === 'TimeoutError') return Object.assign(new Error('请求超时，请检查连接后重试。'), { code: 'skill/request-timeout' });
  if (cause instanceof DOMException && cause.name === 'AbortError') return Object.assign(new Error('操作已取消。'), { code: 'skill/request-cancelled' });
  return cause instanceof Error ? cause : new Error('无法连接技能管理服务，请重试。');
}

async function request<T>(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { ...init, signal: requestSignal });
    const result = await response.json() as { ok?: boolean; value?: unknown; error?: unknown };
    if (!result.ok) throw failure(result.error);
    return result.value as T;
  } catch (cause) {
    throw transportFailure(cause);
  }
}

async function call<T>(ctx: Context, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  void ctx;
  return request<T>(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload }),
  }, timeoutOf(endpoint), signal);
}

/**
 * 端点级超时：市场安装要下载技能包并完成官方导入，详情说明要下载并解包附件，
 * 都远超普通查询，单独放宽；其余查询与写入维持原有口径。
 */
function timeoutOf(endpoint: string): number {
  if (endpoint === 'market-install' || endpoint === 'market-document' || endpoint === 'commit-import') return 120_000;
  if (endpoint === 'install-catalog') return 60_000;
  return 30_000;
}

export function createSkillManagementClient(ctx: Context, lifetime?: AbortSignal) {
  const scoped = (signal?: AbortSignal) => lifetime && signal ? AbortSignal.any([lifetime, signal]) : lifetime ?? signal;
  const invoke = <T>(endpoint: string, payload: unknown, signal?: AbortSignal) => call<T>(ctx, endpoint, payload, scoped(signal));
  return {
    list: () => invoke<readonly ManagedSkillSummary[]>('list', {}),
    catalog: () => invoke<SkillCatalogSummary>('catalog', {}),
    installFromCatalog: (name: string) => invoke<SkillMutationReceipt>('install-catalog', { name }),
    detail: (name: string) => invoke<ManagedSkillDetail>('detail', { name }),
    update: (request: SkillWriteRequest) => invoke<ManagedSkillDetail>('update', request),
    resource: (name: string, resourcePath: string) => invoke<ManagedSkillResource>('resource', { name, path: resourcePath }),
    writeResource: (request: SkillResourceWriteRequest) => invoke<ManagedSkillResource>('write-resource', request),
    setEnabled: (name: string, enabled: boolean) => invoke<SkillMutationReceipt>('set-enabled', { name, enabled }),
    dependencyImpact: (name: string) => invoke<SkillDependencyImpact>('dependency-impact', { name }),
    uninstall: (name: string, expectedImpactRevision: string) => invoke<SkillMutationReceipt>('uninstall', { name, expectedImpactRevision }),
    batch: (names: readonly string[], action: SkillBatchAction) => invoke<SkillBatchResult>('batch', { names, action }),
    listTrash: () => invoke<readonly TrashedSkillSummary[]>('trash-list', {}),
    restore: (id: string) => invoke<SkillMutationReceipt>('restore', { id }),
    stageImport: async (file: File, signal?: AbortSignal) => {
      return request<StagedSkillImport>(`${path}/import`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-workdsh-file-name': encodeURIComponent(file.name) },
        body: file,
      }, 120_000, scoped(signal));
    },
    commitImport: (id: string, scope: SkillInstallScope, signal?: AbortSignal) => invoke<SkillMutationReceipt>('commit-import', { id, scope }, signal),
    discardImport: (id: string) => invoke<null>('discard-import', { id }),
    marketAvailable: () => invoke<{ available: boolean }>('market-available', {}),
    marketList: (input: SkillMarketQuery) => invoke<SkillMarketPage>('market-list', input),
    marketCategories: () => invoke<readonly SkillScene[]>('market-categories', {}),
    /** 全量授权技能索引：本地技能的业务场景标签按标识匹配这份数据。 */
    marketIndex: () => invoke<readonly SkillMarketAuthorized[]>('market-index', {}),
    /** 安装到本机：宿主下载市场附件后走官方导入链路（共享范围），返回技能名与落地状态。 */
    marketInstall: (id: string) => invoke<SkillMarketInstallResult>('market-install', { id }),
    /** 卸载上报：后台记账失败不阻断本机卸载，reported 表示上报是否成功。 */
    marketUninstall: (target: { id?: string; slug?: string }) => invoke<{ reported: boolean }>('market-uninstall', target),
    /** 详情页说明：附件信息与 SKILL.md 正文（zip 附件由宿主解包）。 */
    marketDocument: (id: string) => invoke<SkillMarketDocument>('market-document', { id }),
    openDirectory: async (path: string) => {
      lifetime?.throwIfAborted();
      const result = await ctx.remote.session.openWorkspacePath({ path, action: 'reveal' });
      if (!result.ok) throw failure(result.error);
    },
  };
}

export type SkillManagementClient = ReturnType<typeof createSkillManagementClient>;
