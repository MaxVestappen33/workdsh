import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkbenchRequirementsRevision } from 'workdsh-contracts';
import { WorkbenchAdjustmentForm } from './WorkbenchAdjustmentForm.js';
import { WorkbenchRequirementsForm } from './WorkbenchRequirementsForm.js';
import { createWorkbenchRequirementsClient } from './requirements-client.js';

export interface WorkbenchRequirementsEditorProps {
  readonly developmentId: string;
  /** Non-secret identity scope from the owning UI. Server authorization remains independent. */
  readonly identityScopeKey: string;
  readonly onSaved: (revision: WorkbenchRequirementsRevision, signal?: AbortSignal) => Promise<void>;
  readonly onCancel: () => void;
}
export function WorkbenchRequirementsEditor(props: WorkbenchRequirementsEditorProps) {
  return <Editor key={JSON.stringify([props.identityScopeKey, props.developmentId])} {...props} />;
}
function Editor(props: WorkbenchRequirementsEditorProps) {
  const [adjusting, setAdjusting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [current, setCurrent] = useState<WorkbenchRequirementsRevision>();
  const pendingSave = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  const [followupFailed, setFollowupFailed] = useState(false);
  const [followupMessage,setFollowupMessage]=useState<string>();
  const [followingUp, setFollowingUp] = useState(false);
  const [handedOffRevision, setHandedOffRevision] = useState<string>();
  const pendingFollowup = useRef<AbortController | undefined>(undefined);
  async function followUp(saved: WorkbenchRequirementsRevision) {
    if (pendingFollowup.current) return;
    const request = new AbortController(); pendingFollowup.current = request;
    setFollowingUp(true);
    setHandedOffRevision(undefined);
    try {
      await props.onSaved(saved, request.signal);
      if (mounted.current && !request.signal.aborted) {setFollowupFailed(false);setFollowupMessage(undefined);setHandedOffRevision(saved.id);}
    } catch (cause) {
      if (mounted.current && !request.signal.aborted) {
        setFollowupFailed(true);
        const code=cause instanceof Error?cause.message:'';
        setFollowupMessage(code === 'workbench/development-creator-required'
          ?'这份开发会话尚未使用官方创造模式，需求与源码已保留。未开始对话时，可在原生会话中选择“创造模式”后返回重试；已经开始的会话不能切换模式，需要另行关联创造模式开发会话。'
          :['workbench/development-draft-not-empty','workbench/development-draft-conflict'].includes(code)
          ?'开发会话中已有未发送的草稿，未覆盖你的内容。请从开发记录打开原有会话，处理或保存草稿后再返回重试；无需重新提交修改意见。'
          :'需求已保存，开发关联尚未确认。重试将使用已保存版本，不再新增需求修订。');
      }
    } finally {
      if (pendingFollowup.current === request) pendingFollowup.current = undefined;
      if (mounted.current && !request.signal.aborted) setFollowingUp(false);
    }
  }
  const client = useMemo(() => createWorkbenchRequirementsClient(), []);
  useEffect(() => {
    const request = new AbortController();
    mounted.current = true;
    void client.history(props.developmentId, request.signal).then(history => {
      if (!request.signal.aborted) { setCurrent(history.at(-1)); setLoading(false); }
    }).catch(() => { if (!request.signal.aborted) { setError(true); setLoading(false); } });
    return () => { mounted.current = false; request.abort(); pendingSave.current?.abort(); pendingFollowup.current?.abort(); };
  }, [client, props.developmentId]);
  if (loading) return <p role="status">正在读取需求基线…</p>;
  if (error) return <section><p role="alert">无法读取需求，请返回后重新打开。未创建新的需求修订。</p><button onClick={props.onCancel}>返回</button></section>;
  const Form = current && adjusting ? WorkbenchAdjustmentForm : WorkbenchRequirementsForm;
  const handoffStatus = handedOffRevision && handedOffRevision === current?.id ? <section role="status" style={{ margin: '16px 32px', padding: 16, border: '1px solid currentColor', borderRadius: 8 }}>
    <strong>需求已保存，提示词已放入开发会话草稿</strong>
    <p>请在开发会话中检查并发送草稿，Agent 才会开始开发。完成后回到这份开发记录的“安装试用”，检查候选插件并安装。</p>
    <p>试用后需要修改，可回到“继续开发”选择模块或页面，描述调整；后续更新沿用同一个插件。</p>
  </section> : null;
  return <>{handoffStatus}{current && <nav aria-label="开发方式" className="wd-requirements-mode"><button disabled={followingUp || followupFailed} onClick={() => setAdjusting(true)}>修改意见</button><button disabled={followingUp || followupFailed} onClick={() => setAdjusting(false)}>修改完整需求</button></nav>}{followupFailed && <section><p role="alert">{followupMessage??'需求已保存，开发关联尚未确认。重试将使用已保存版本，不再新增需求修订。'}</p><button disabled={followingUp || !current} onClick={() => { if (current) void followUp(current); }}>核对并重试开发关联</button> <button disabled={followingUp} onClick={props.onCancel}>返回开发记录</button></section>}{followingUp && <p role="status">正在关联已保存需求…</p>}<fieldset disabled={followingUp || followupFailed} style={{ border: 0, padding: 0, margin: 0 }}><Form initial={current?.requirements} onCancel={props.onCancel} onSave={async draft => {
    const request = new AbortController(); pendingSave.current = request;
    const saved = await client.append(props.developmentId, draft, current?.id, request.signal);
    if (!mounted.current || request.signal.aborted) return;
    setCurrent(saved);
    setHandedOffRevision(undefined);
    setFollowupFailed(false);setFollowupMessage(undefined);
    await followUp(saved);
  }} /></fieldset></>;
}
