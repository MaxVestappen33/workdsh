import type { ReactNode } from 'react';

/**
 * 官方没有提供隐藏侧栏面板或移除第三方设置 tab 的 API，这里只做一层视觉隐藏：
 * - 侧栏「插件」面板按钮：官方 sidebar.panellist 行只有本地化 aria-label 可作锚点；
 * - 设置 → 内置插件里 dsh-market 注册的「插件市场」tab：官方 tab 按钮 id 以 `-tab-dsh-market` 结尾。
 * 插件页本身保留，由 设置 → 内置插件 → 插件设置 打开；官方调整 DOM 后需要同步核对选择器。
 */
const css = `
button[aria-label="插件"],button[aria-label="Plugins"]{display:none!important}
[id$="-tab-dsh-market"]{display:none!important}
`;

export function OfficialEntriesHidden(): ReactNode {
  return <style>{css}</style>;
}
