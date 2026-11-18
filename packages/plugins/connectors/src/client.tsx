import type { ComposerHandoff, ComposerHandoffSource } from 'workdsh-contracts/composer';
declare module '@deepseek-ai/cordis' { interface Events { 'workdsh/composer-handoff'(handoff: ComposerHandoff): Promise<void>; } }
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { ConnectorsPanel } from './client/ConnectorsPanel.js';
import { ConnectorPicker } from './client/ConnectorPicker.js';
import { connectorTrialDraft, connectorTrialDraftKey, PendingConnectorDraft } from './client/trial-draft.js';
import { createConnectorManagementClient } from './client/management.js';

export const name = 'workdsh-connectors-client';
/**
 * 试用入口要新建会话并预选连接器，因此依赖会话/工作区服务。
 * 这里按名字声明依赖、运行时按结构化类型取用：连接器包不额外引这些包的运行时依赖，
 * 服务由客户端宿主（与技能插件共用）提供。
 */
export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'remote', 'remote.session', 'connection', 'uiWorkspace'];

/** 会话/工作区服务的最小结构面（字段与技能插件使用的官方客户端一致）。 */
interface TrialServices {
  readonly sessions?: {
    readonly list: { getSnapshot(): { readonly byId: Readonly<Record<string, { readonly id: string; readonly cwd?: string; readonly retainedBy?: { readonly mainView?: number } }>> } };
    create(input: { workspaceId: string; cwd: string }): Promise<string>;
  };
  readonly workspaces?: {
    readonly list: { getSnapshot(): { readonly items: readonly { readonly workspaceId: string; readonly path: string; readonly sessionIds: readonly string[] }[] } };
  };
  readonly uiWorkspace?: { openSession(sessionId: string): void };
}

export function apply(ctx: Context): void {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'workdsh.connectors.client');
  const management = createConnectorManagementClient(ctx, lifetime.signal);
  const services = ctx as unknown as TrialServices;
  ctx.on('workdsh/composer-handoff', async handoff => {
    const selected = await management.selection(handoff.sourceSessionId);
    await management.setSelection(handoff.targetSessionId, selected);
  });
  const openCapability = (key: string) => ctx.layout.selectPanel(key as Parameters<typeof ctx.layout.selectPanel>[0]);
  const hasCapability = (key: string) => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === key);
  /** 当前会话所在的工作区：新建会话要落在用户正在用的工作区里，与技能试用同一判定。 */
  const resolveWorkspace = () => {
    const sessions = services.sessions;
    const workspaces = services.workspaces?.list.getSnapshot().items ?? [];
    if (!sessions) return workspaces[0];
    const state = sessions.list.getSnapshot();
    const currentId = Object.values(state.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id;
    return (currentId ? workspaces.find(row => row.sessionIds.includes(currentId)) : undefined)
      ?? workspaces.find(row => row.path === (currentId ? state.byId[currentId]?.cwd : undefined))
      ?? workspaces[0];
  };
  /**
   * 「去试试」：新建会话 → 只选中该 MCP → 预填提示词 → 打开会话。
   * 不自动发送：MCP 没有斜杠命令，提示词只是替用户写好开场白，仍需本人补完任务内容。
   */
  const startConnectorTrial = async (connectorId: string, title: string): Promise<void> => {
    lifetime.signal.throwIfAborted();
    const sessions = services.sessions;
    const workspace = resolveWorkspace();
    if (!sessions || !services.uiWorkspace) throw new Error('当前环境不支持新建会话，无法试用该 MCP。');
    if (!workspace) throw new Error('请先打开一个工作区，再试用该 MCP。');
    const sessionId = await sessions.create({ workspaceId: workspace.workspaceId, cwd: workspace.path });
    lifetime.signal.throwIfAborted();
    // 会话选择与「输入框左侧的连接器选择器」共用同一份记录，因此两边状态一致。
    await management.setSelection(sessionId, [connectorId]);
    window.sessionStorage.setItem(connectorTrialDraftKey, connectorTrialDraft(title));
    services.uiWorkspace.openSession(sessionId);
    ctx.layout.selectPanel(null);
  };
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'workdsh-connectors',
    inject: () => ({ toggleNavigation: () => ctx.layout.toggleSidebar(), management, openCapability, hasCapability, startConnectorTrial }),
  }, ConnectorsPanel));
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'workdsh-connectors-picker', order: 30,
    inject: () => ({ management, openManagement: () => openCapability('workdsh-connectors') }),
  }, ConnectorPicker));
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'workdsh-connector-trial-draft',
  }, PendingConnectorDraft));
}
