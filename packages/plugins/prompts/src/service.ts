/** 授权提示词的宿主侧服务：只读列表，路径由宿主注入、缺失时回退到内置默认值。 */
import { Service, type Context } from '@deepseek-ai/cordis';
import { PromptClient, type PromptBackend } from './market.js';
import {
  DEFAULT_PROMPT_PATHS, PromptRequestError,
  type PromptPage, type PromptPaths, type PromptQuery,
} from './shared.js';

export interface PromptApi {
  /** 通用后台通道缺失或没有绑定时为 false，界面据此提示「未接入」。 */
  available(): Promise<boolean>;
  list(input?: PromptQuery, signal?: AbortSignal): Promise<PromptPage>;
}

declare module '@deepseek-ai/cordis' { interface Context { workdshPrompts: PromptApi } }

export interface PromptOptions {
  /**
   * 提示词接口路径。由宿主（Desktop）从 ServerConfig 注入；未配置时回退到内置默认值。
   * 本包是 Desktop/Web 共用的 Profile 包，因此不直接读取 Desktop 专有模块。
   */
  readonly paths?: Partial<PromptPaths>;
}

export class PromptService extends Service implements PromptApi {
  private client?: PromptClient;

  constructor(ctx: Context, private readonly options: PromptOptions = {}) {
    super(ctx, 'workdshPrompts');
  }

  async available(): Promise<boolean> {
    const channel = this.channel();
    if (!channel) return false;
    try {
      return await channel.available();
    } catch {
      return false;
    }
  }

  async list(input: PromptQuery = {}, signal?: AbortSignal): Promise<PromptPage> {
    return (await this.client_()).list(input, signal);
  }

  private async client_(): Promise<PromptClient> {
    if (this.client) return this.client;
    const channel = this.channel();
    if (!channel) throw new PromptRequestError('prompt/unavailable', '当前环境未接入提示词服务。');
    const list = this.options.paths?.list?.trim() || DEFAULT_PROMPT_PATHS.list;
    if (!list.startsWith('/')) throw new PromptRequestError('prompt/unavailable', '提示词列表路径无效。');
    this.client = new PromptClient({ paths: { list }, backend: channel });
    return this.client;
  }

  /** 通用后台通道是可选注入的宿主能力：缺失时提示词整体不可用，插件本身照常加载。 */
  private channel(): PromptBackend | undefined {
    return this.ctx.reflect.get('workdshBackend') as PromptBackend | undefined;
  }
}
