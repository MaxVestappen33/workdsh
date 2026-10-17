import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {
  CustomModelDefinition, CustomModelDraft, CustomModelEntry,
  ModelMarketDetail, ModelMarketInstallResult, ModelMarketPage, ModelMarketQuery,
  ModelMarketUninstallResult,
} from '../shared.js';

const path = '/api/workdsh-model-market';
const QUERY_TIMEOUT_MS = 20_000;
const MUTATE_TIMEOUT_MS = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function requestFailure(cause: unknown, timeoutMs: number, signal?: AbortSignal): Error {
  if (signal?.aborted) return new Error('请求已取消。');
  if (cause instanceof DOMException && cause.name === 'TimeoutError') {
    return new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒），请刷新后确认结果。`);
  }
  if (cause instanceof DOMException && cause.name === 'AbortError') return new Error('请求已取消。');
  return new Error('本地服务暂不可用，请稍后重试。');
}

async function invoke<T>(endpoint: string, payload: unknown, signal?: AbortSignal, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    throw requestFailure(cause, timeoutMs, signal);
  }
  const result = await response.json().catch(() => ({})) as { ok?: boolean; value?: unknown; error?: unknown };
  if (!result.ok) {
    const error = isRecord(result.error) ? result.error : {};
    throw new Error(typeof error.message === 'string' ? error.message : '模型市场操作失败，请重试。');
  }
  return result.value as T;
}

export function createModelMarketClient(lifetime?: AbortSignal) {
  return {
    available: () => invoke<{ available: boolean }>('available', {}, lifetime),
    list: (query: ModelMarketQuery) => invoke<ModelMarketPage>('list', query, lifetime),
    detail: (id: string) => invoke<ModelMarketDetail>('detail', { id }, lifetime),
    install: (id: string) => invoke<ModelMarketInstallResult>('install', { id }, lifetime, MUTATE_TIMEOUT_MS),
    uninstall: (id: string) => invoke<ModelMarketUninstallResult>('uninstall', { id }, lifetime, MUTATE_TIMEOUT_MS),
    customList: () => invoke<readonly CustomModelEntry[]>('custom-list', {}, lifetime),
    customInstall: (draft: CustomModelDraft) => invoke<CustomModelEntry>('custom-install', draft, lifetime, MUTATE_TIMEOUT_MS),
    customUpdate: (key: string, draft: CustomModelDraft) =>
      invoke<CustomModelEntry>('custom-update', { key, ...draft }, lifetime, MUTATE_TIMEOUT_MS),
    customUninstall: (key: string) => invoke<ModelMarketUninstallResult>('custom-uninstall', { key }, lifetime, MUTATE_TIMEOUT_MS),
    customDiscover: (input: { apiUrl: string; apiProtocol: string; apiKey: string }) =>
      invoke<readonly CustomModelDefinition[]>('custom-discover', input, lifetime, 30_000),
  };
}

export type ModelMarketClient = ReturnType<typeof createModelMarketClient>;
