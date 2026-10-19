import React, { useEffect, useMemo, useState } from 'react';
import { WorkbenchAuthoringPanel, type WorkbenchAuthoringPanelProps } from './WorkbenchAuthoringPanel.js';
import { createWorkbenchDevelopmentClient } from './development-client.js';

export type WorkbenchIdentityAuthoringPanelProps = Omit<WorkbenchAuthoringPanelProps, 'identityScopeKey'>;
/** Resolve scope before opening the editor; retries cannot expose an unverified scope. */
export function WorkbenchIdentityAuthoringPanel(props: WorkbenchIdentityAuthoringPanelProps) {
  const client = useMemo(() => createWorkbenchDevelopmentClient(), []);
  const [scope, setScope] = useState<string>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let pending: AbortController | undefined;
    const check = () => {
      pending?.abort(); const request = new AbortController(); pending = request;
      setScope(undefined); setError(false);
      void client.identityScope(request.signal).then(identity => {
        if (!request.signal.aborted) setScope(JSON.stringify([identity.organizationId, identity.principalId]));
      }).catch(() => { if (!request.signal.aborted) setError(true); });
    };
    check();
    return () => pending?.abort();
  }, [client, attempt]);
  if (!scope) return <section style={{ padding: 28 }}>
    <p role={error ? 'alert' : 'status'}>{error ? '无法确认当前账号，请核对登录状态后重试。' : '正在确认当前账号…'}</p>
    {error && <button onClick={() => setAttempt(value => value + 1)}>重试</button>}
    <button onClick={props.onClose}>返回工作台管理</button>
  </section>;
  return <WorkbenchAuthoringPanel key={scope} identityScopeKey={scope} {...props} />;
}
