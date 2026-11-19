/**
 * 设置导航与跨树请求的共享通道。
 *
 * 官方设置外壳把「打开到指定分区」收在自身 store 里（`actions.openSection`），
 * 没有对外暴露服务；会话里的模型座位只拿到座位 props，也拿不到 ctx。
 * 因此由 client 入口在这里挂一个 opener，座位组件只调用导出的函数。
 */

/** 本插件在 `settings.section` 中注册的分区 id。 */
export const MODEL_MARKET_SECTION = 'workdsh-model-market';

/** 设置导航中本页的标签文本。 */
export const MODEL_MARKET_LABEL = '模型管理';

/** 由 client 入口注入的「打开设置并切到指定分区」实现。 */
let opener: ((id: string) => boolean) | undefined;

/**
 * 安装 / 复位设置导航 opener。
 * @param next 打开实现；插件卸载时传 undefined。
 */
export function installSettingsSectionOpener(next: ((id: string) => boolean) | undefined): void {
  opener = next;
}

/**
 * 打开设置并切到指定分区。
 * @param id 已注册的 `settings.section` id。
 * @returns 设置外壳是否接受本次跳转（未就绪时为 false）。
 */
export function openSettingsSection(id: string): boolean {
  return opener?.(id) ?? false;
}

/** 待消费的「添加本地模型」请求：模型管理页多半尚未挂载，先记账再跳转。 */
let pendingCustomModel = false;
const requestListeners = new Set<() => void>();

/** 请求模型管理页打开「添加本地模型」表单。 */
export function requestCustomModelForm(): void {
  pendingCustomModel = true;
  for (const listener of [...requestListeners]) listener();
}

/**
 * 取出并清除待处理请求。
 * @returns 是否存在待处理请求。
 */
export function takeCustomModelRequest(): boolean {
  if (!pendingCustomModel) return false;
  pendingCustomModel = false;
  return true;
}

/** 撤掉尚未消费的请求：跳转失败时避免以后误弹出表单。 */
export function cancelCustomModelRequest(): void {
  pendingCustomModel = false;
}

/**
 * 订阅请求变化：页面已挂载时立即响应，不必等重新挂载。
 * @param listener 变化回调。
 * @returns 取消订阅。
 */
export function subscribeCustomModelRequest(listener: () => void): () => void {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}
