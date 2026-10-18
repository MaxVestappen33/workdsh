/** Session-bound right Sidebar view for the managed Agent browser. */

import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import { browserSessionClient } from './client/api.js';
import { BrowserSessionPane } from './client/BrowserSessionPane.js';
import { browserSessionStyles } from './client/styles.js';

// The Web bundle keeps its Playwright screenshot tab under workdsh-agent-browser.
// Desktop's managed Electron page is a separate provider and must not register
// a second renderer for that same tab kind.
const TAB = 'workdsh-managed-browser';

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { 'workdsh-managed-browser': Record<string, never>; }
}

export const name = 'workdsh-browser-session-client';
export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'sessions'];

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = browserSessionStyles;
    document.head.append(style);
    return () => style.remove();
  }, 'workdsh.browserSession.styles');
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB, kind: TAB, title: () => '任务浏览器',
    guide: [{ id: 'managed-browser', order: 25, title: () => '任务浏览器', description: () => '查看并操作当前任务的网页' }],
  }));
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: TAB,
  }, BrowserSessionPane));

  const sessions = ctx.sessions as unknown as ISessions;
  ctx.effect(() => {
    let stopped = false;
    let checking = false;
    const observed = new Map<string, number>();
    const selectedSession = () => Object.values(sessions.list.getSnapshot().byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id;
    let selection = selectedSession(), selectionRevision = 0;
    const changed = () => { const next = selectedSession(); if (next !== selection) { selection = next; selectionRevision++; } };
    const unsubscribe = sessions.list.subscribe(changed);
    const tick = async () => {
      if (checking || stopped) return;
      changed(); const sessionId = selection, requestedSelection = selectionRevision;
      if (!sessionId) return;
      const hadOwnTab = ctx.sidebarRight.openTabs.getSnapshot().some(tab => tab.sessionId === sessionId && tab.kind === TAB);
      checking = true;
      try {
        const status = await browserSessionClient.status(String(sessionId));
        if (stopped || typeof status?.active !== 'boolean' || !Number.isSafeInteger(status.revision) || status.revision < 0) return;
        // A request can outlive a Session switch; never open the old Session's
        // browser beside the newly selected conversation.
        changed(); if (selection !== sessionId || selectionRevision !== requestedSelection) return;
        const ownTabs = ctx.sidebarRight.openTabs.getSnapshot().filter(tab => tab.sessionId === sessionId && tab.kind === TAB);
        if (!status.active) {
          // Preserve an untouched browser opened explicitly through the guide;
          // a successful close removes only our own pane, once per revision.
          if (status.revision > 0 || observed.has(sessionId)) {
            if (observed.get(sessionId) === status.revision) return;
            observed.set(sessionId, status.revision);
            for (const tab of ownTabs) ctx.sidebarRight.closeIn(sessionId, tab.tabId);
          }
          return;
        }
        if (ownTabs.length) { observed.set(sessionId, status.revision); return; }
        if (hadOwnTab) { observed.set(sessionId, status.revision); return; }
        if (observed.get(sessionId) === status.revision) return;
        ctx.sidebarRight.openTabIn(sessionId, TAB, { params: {} });
        if (ctx.sidebarRight.openTabs.getSnapshot().some(tab => tab.sessionId === sessionId && tab.kind === TAB)) {
          observed.set(sessionId, status.revision);
        }
      } catch { /* The browser provider is optional and may be unavailable. */ }
      finally { checking = false; }
    };
    const timer = window.setInterval(() => void tick(), 1_500);
    void tick();
    return () => { stopped = true; unsubscribe(); window.clearInterval(timer); };
  }, 'workdsh.browserSession.autoOpen');
}
