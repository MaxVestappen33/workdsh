import type { WorkbenchCatalogEntry } from './catalog-client.js';

/** Report observed runtime state before the operation's acknowledgement. */
export function activationMessage(title: string, enabled: boolean,
  observed?: WorkbenchCatalogEntry,
  result?: { confirmed: boolean; pendingRestart: boolean }) {
  if (enabled && observed?.selected && observed.runtimeStatus === 'failed')
    return `“${title}”已启用，但应用启动失败。请查看制作进度，修复后安装新版本。`;
  if (observed?.selected === enabled) {
    if (!enabled && result?.confirmed) return `“${title}”已停用。`;
    if (enabled && observed.runtimeStatus === 'active' && observed.registered)
      return `“${title}”已启动，可以打开试用。`;
    if (enabled && observed.runtimeStatus === 'loading') return `“${title}”正在启动，请稍后刷新。`;
  }
  if (result?.pendingRestart) return `“${title}”的设置已保存，需要重启后核对运行状态。`;
  return `暂时无法确认“${title}”${enabled ? '启动' : '停用'}的结果，请刷新重试。`;
}
