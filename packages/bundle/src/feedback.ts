import type { Context } from '@deepseek-ai/cordis';

/**
 * 反馈上报：官方 `/feedback` 弹窗与点赞/点踩只往会话日志追加 `feedback/record`，
 * 这里订阅同一条事件流，把用户提交的分类与详情转发到业务后台管理接口，
 * 不复制弹窗、不改官方提交动作，本机日志照旧保留。
 */

/** 后台「反馈新增」接口；与其它 desktop-client 接口一样，可由插件选项覆盖。 */
export const DEFAULT_FEEDBACK_ADD_PATH = '/desktop-client/feedback/add';

/** 后台通道的最小结构面：本包不依赖通道提供方，只要求一个 POST。 */
interface BackendLike {
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
}

interface SessionEventLike {
  readonly type: string;
  readonly data?: unknown;
}

interface SessionLike {
  readonly id?: unknown;
}

/** 只声明本包用到的事件订阅面，避免为了一个事件引入官方的会话类型依赖。 */
interface SessionEventBus {
  on(name: 'session/event', listener: (session: SessionLike, event: SessionEventLike) => void): () => void;
}

/** 透传给后台的载荷：分类缺省时不传 type，详情为空时不传 content，由后台决定兜底与是否入库。 */
interface FeedbackPayload {
  readonly type?: string;
  readonly content?: string;
  /** 客户端标识（workdsh-app.json 的 server.appId），由载体经环境变量下发。 */
  readonly appId?: string;
  /** Node 平台名：darwin / win32 / linux。 */
  readonly platform: string;
  /** Node 架构名：arm64 / x64。 */
  readonly arch: string;
  /** 客户端版本号（安装包版本），由载体经环境变量下发。 */
  readonly version?: string;
}

/** 载体下发的客户端标识；未注入时整字段省略，由后台按缺省处理。 */
function carrierValue(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** 官方 `feedback/record` 的载荷：详情与分类都可缺省。 */
function feedbackPayload(event: SessionEventLike): FeedbackPayload {
  const data = event.data !== null && typeof event.data === 'object' ? event.data as { text?: unknown; category?: unknown } : {};
  const category = typeof data.category === 'string' ? data.category.trim() : '';
  const text = typeof data.text === 'string' ? data.text : '';
  const appId = carrierValue('WORKDSH_APP_ID');
  const version = carrierValue('WORKDSH_APP_VERSION');
  return {
    ...category.length > 0 ? { type: category } : {},
    ...text.trim().length > 0 ? { content: text } : {},
    ...appId.length > 0 ? { appId } : {},
    platform: process.platform,
    arch: process.arch,
    ...version.length > 0 ? { version } : {},
  };
}

/** 一次上报：个人模式没有后台绑定时静默跳过，其它失败只写一行诊断，绝不打断用户。 */
async function submit(scope: Context, path: string, payload: FeedbackPayload, sessionId: string): Promise<void> {
  const backend = scope.get('workdshBackend') as BackendLike | undefined;
  if (backend === undefined) return;
  try {
    await backend.post(path, payload);
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    if (code === 'backend/unavailable') return;
    process.stdout.write(`[workdsh:feedback] 上报失败 session=${sessionId} code=${typeof code === 'string' ? code : 'unknown'}\n`);
  }
}

/**
 * 安装反馈转发。通道未挂载时注入回调不会执行；挂载后每条 `feedback/record`
 * 都按 `{ type, content }` 提交，与后台接口参数一一对应。
 */
export function installFeedbackForwarder(ctx: Context, addPath: string = DEFAULT_FEEDBACK_ADD_PATH): void {
  ctx.inject(['workdshBackend'], (scope) => {
    const bus = scope as unknown as SessionEventBus;
    return scope.effect(() => bus.on('session/event', (session, event) => {
      if (event?.type !== 'feedback/record') return;
      void submit(scope, addPath, feedbackPayload(event), String(session?.id ?? ''));
    }), 'workdsh.feedback.forward');
  });
}
