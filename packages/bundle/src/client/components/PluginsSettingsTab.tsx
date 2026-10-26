import type { ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import { closeTopModal } from '@deepseek-ai/dsh-client-ui-primitives';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';

/** 官方 ui-plugin-manager 注册到 main 槽位的面板 key，也就是侧栏「插件」页。 */
const PLUGINS_PANEL = 'plugins';

const css = `
.wd-plugins-settings{display:flex;flex-direction:column;gap:12px;max-width:560px;color:var(--dsw-alias-label-primary);font:inherit}
.wd-plugins-settings-title{margin:0;font-size:14px;font-weight:500;line-height:22px}
.wd-plugins-settings-text{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.wd-plugins-settings-open{align-self:flex-start;padding:7px 16px;border:none;border-radius:10px;background:var(--dsw-alias-state-business-primary);color:#fff;font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.wd-plugins-settings-open:hover{filter:brightness(1.06)}
`;

/**
 * 设置 → 内置插件 的「插件设置」tab。
 *
 * 官方插件页（安装、启停、卸载、实验性插件、社区市场）由 ui-plugin-manager 自己渲染，
 * 组件没有对外导出，也没有「把 main 面板嵌进设置 tab」的官方机制，因此这里不复制那套界面，
 * 只提供入口：先收起设置模态层，再切到官方插件页，功能与官方完全一致。
 */
export function pluginsSettingsTab(ctx: Context) {
  return function PluginsSettingsTab(): ReactNode {
    const available = ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === PLUGINS_PANEL);
    const open = (): void => {
      // 设置是模态层；closeTopModal 是官方关闭助手，会走同一个设置壳的 onClose。
      closeTopModal(document);
      if (available) ctx.layout.selectPanel(PLUGINS_PANEL as Parameters<typeof ctx.layout.selectPanel>[0]);
    };
    return (
      <div className="wd-plugins-settings">
        <style>{css}</style>
        <p className="wd-plugins-settings-title">插件管理</p>
        <p className="wd-plugins-settings-text">安装、启用、停用和卸载插件，查看实验性插件与社区市场。</p>
        {available
          ? <button type="button" className="wd-plugins-settings-open" onClick={open}>打开插件管理</button>
          : <p className="wd-plugins-settings-text">当前组合没有提供官方插件管理页。</p>}
      </div>
    );
  };
}
