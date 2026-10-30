/** 渲染层的提示词客户端：只调用宿主端点，不携带后台地址与凭据。 */
import type { PromptPage, PromptQuery } from '../shared.js';

const path = '/api/workdsh-prompts';
const REQUEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(value: unknown): Error {
  if (isRecord(value) && typeof value.message === 'string') return Object.assign(new Error(value.message), { code: typeof value.code === 'string' ? value.code : 'prompt/request-failed' });
  return new Error('提示词加载失败，请重试。');
}

function transportFailure(cause: unknown): Error {
  if (cause instanceof DOMException && cause.name === 'TimeoutError') return Object.assign(new Error('请求超时，请检查连接后重试。'), { code: 'prompt/request-timeout' });
  if (cause instanceof DOMException && cause.name === 'AbortError') return Object.assign(new Error('操作已取消。'), { code: 'prompt/request-cancelled' });
  return cause instanceof Error ? cause : new Error('无法连接提示词服务，请重试。');
}

async function request<T>(init: RequestInit, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(path, { ...init, signal: requestSignal });
    const result = await response.json() as { ok?: boolean; value?: unknown; error?: unknown };
    if (!result.ok) throw failure(result.error);
    return result.value as T;
  } catch (cause) {
    throw transportFailure(cause);
  }
}

export interface PromptClient {
  available(): Promise<boolean>;
  list(input: PromptQuery, signal?: AbortSignal): Promise<PromptPage>;
}

export function createPromptClient(lifetime?: AbortSignal): PromptClient {
  const call = <T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> => request<T>({
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload }),
  }, lifetime && signal ? AbortSignal.any([lifetime, signal]) : lifetime ?? signal);
  return {
    available: async () => (await call<{ available: boolean }>('available', {})).available,
    list: (input, signal) => call<PromptPage>('list', input, signal),
  };
}
