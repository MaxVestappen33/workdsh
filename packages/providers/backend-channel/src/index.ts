import { Service, type Context } from '@deepseek-ai/cordis';
import { BackendClient, type BackendBinding, type BackendBindingProvider, type BackendChannelClient, type BackendQuery } from './backend-client.js';

export * from './backend-client.js';

/**
 * 通用业务后台通道的宿主侧入口。各功能插件（MCP 市场、后续的 skills 等）
 * 只声明自己的路径与字段映射，请求头、地址拼接、信封解开与错误透传都在本通道内完成。
 */
export interface BackendChannel extends BackendChannelClient {
  /** 绑定存在且可用于请求时为 true；界面据此隐藏后台能力入口。 */
  available(): Promise<boolean>;
}

declare module '@deepseek-ai/cordis' { interface Context { workdshBackend: BackendChannel } }

/** 身份提供方按需下发的业务后台绑定；只有 Desktop 账号/企业身份才会实现它。 */
interface BackendBindingIdentity {
  backendBinding?(signal?: AbortSignal): Promise<BackendBinding>;
  /** 可选：成员身份的请求被后台判定为未授权时通知身份侧触发失效流程。 */
  backendUnauthorized?(): Promise<void> | void;
}

export const name = 'workdsh-provider-backend-channel';
export const inject = ['workdshIdentity'];

/**
 * 通道本身不持有身份：绑定每次向 workdshIdentity.backendBinding() 索取，缺失或不可用时
 * 整体降级为不可用，不抛错、也不影响本插件与消费方插件加载。
 */
export class BackendChannelService extends Service implements BackendChannel {
  private readonly backend: BackendClient;

  constructor(ctx: Context) {
    super(ctx, 'workdshBackend');
    const provider: BackendBindingProvider = {
      binding: signal => this.binding(signal),
      // 绑定来源实现 backendUnauthorized() 时，把后台的 401 通知转达给身份侧；未实现即静默。
      unauthorized: () => this.unauthorized(),
    };
    this.backend = new BackendClient({ binding: provider });
  }

  async available(): Promise<boolean> {
    try { return (await this.binding()) !== undefined; } catch { return false; }
  }

  get<T = unknown>(path: string, query?: BackendQuery, signal?: AbortSignal): Promise<T> {
    return this.backend.get<T>(path, query, signal);
  }

  post<T = unknown>(path: string, body?: unknown, query?: BackendQuery, signal?: AbortSignal): Promise<T> {
    return this.backend.post<T>(path, body, query, signal);
  }

  postForm<T = unknown>(path: string, form: FormData, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
    return this.backend.postForm<T>(path, form, signal, timeoutMs);
  }

  /** 不缓存凭据，也不把绑定写入任何 Host 状态；身份提供方未实现该能力时视为没有绑定。 */
  private binding(signal?: AbortSignal): Promise<BackendBinding | undefined> {
    const identity = this.ctx.reflect.get('workdshIdentity') as BackendBindingIdentity | undefined;
    if (typeof identity?.backendBinding !== 'function') return Promise.resolve(undefined);
    return identity.backendBinding(signal);
  }

  /** 身份侧未实现 backendUnauthorized() 时静默返回；它的失败由通道吞掉，不影响原始错误。 */
  private async unauthorized(): Promise<void> {
    const identity = this.ctx.reflect.get('workdshIdentity') as BackendBindingIdentity | undefined;
    await identity?.backendUnauthorized?.();
  }
}

export function apply(ctx: Context): void {
  ctx.plugin(BackendChannelService);
}
