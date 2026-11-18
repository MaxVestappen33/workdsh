import * as React from 'react';
import { useEffect } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

/**
 * 「去试试」的草稿交接键。
 *
 * 技能试用预填的是 `/技能名`（斜杠命令），MCP 没有对应的命令，因此预填一句自然语言，
 * 由用户在输入框里补完再发送；跨「新建会话 → 打开会话」的交接靠 sessionStorage，
 * 与技能试用的实现同一套（见 skills 的 PendingSkillDraft）。
 */
export const connectorTrialDraftKey = 'workdsh.pending-connector-trial-draft';

/** 试用提示词：`{title}` 由调用方替换成 MCP 名称。 */
export const connectorTrialDraft = (title: string): string => `请使用「${title}」MCP 完成以下任务：`;

/** 会话输入框挂载后写入待试用草稿；草稿只消费一次，避免下次进入会话又出现。 */
export function PendingConnectorDraft({ inputActions }: PropsRuntime<'conversation.input.overlay'>) {
  useEffect(() => {
    const draft = window.sessionStorage.getItem(connectorTrialDraftKey);
    if (!draft) return;
    const timer = window.setTimeout(() => {
      inputActions.setDraft(draft);
      window.sessionStorage.removeItem(connectorTrialDraftKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inputActions]);
  return null;
}
