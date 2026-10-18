import React from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import { WorkbenchAuthoringPanel, type WorkbenchAuthoringPanelProps } from './WorkbenchAuthoringPanel.js';
import { WORKBENCH_MANAGER_PANEL } from './native-page.js';

export const WORKBENCH_AUTHORING_PANEL = 'workdsh-workbench-authoring';
type NativeContext = Pick<Context, 'slots' | 'layout' | 'sessions' | 'conversation' | 'uiWorkspace'>;

/** The enclosing Client owner supplies the current non-secret identity scope and
 * remounts on identity changes. This adapter adds only native Slots. */
export function mountNativeWorkbenchAuthoring(ctx: NativeContext, identityScopeKey: string,
  Page: React.ComponentType<WorkbenchAuthoringPanelProps> = WorkbenchAuthoringPanel) {
  if (!identityScopeKey.trim()) throw new Error('workbench/identity-scope-unavailable');
  let stopped = false;
  const close = () => {
    const manager = ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === WORKBENCH_MANAGER_PANEL);
    ctx.layout.selectPanel(manager ? WORKBENCH_MANAGER_PANEL as MainPanelId : null);
  };
  const dispose = ctx.slots.inject('main', () => {
    const removePage = ctx.slots.register({ name: 'main', key: WORKBENCH_AUTHORING_PANEL },
      () => <Page identityScopeKey={identityScopeKey} native={ctx} onClose={close} />);
    return () => { try { if (ctx.layout.panelInfo.getSnapshot().activePanelId === WORKBENCH_AUTHORING_PANEL) close(); } finally { removePage(); } };
  });
  return () => { if (stopped) return; stopped = true; dispose(); };
}
