import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWorkbenchActivationClient } from './activation-client.js';
import { createWorkbenchImportPreparationClient, type WorkbenchImportPreparation } from './prepare-import-client.js';
import { createWorkbenchImportClient, type WorkbenchImportSelection } from './import-client.js';
import { createWorkbenchUploadClient, type WorkbenchUploadSelection } from './upload-client.js';
import { createWorkbenchDevelopmentClient } from './development-client.js';
import { assertWorkbenchCandidateIdentity, readWorkbenchCandidateDevelopment, type WorkbenchCandidateDevelopment } from './candidate-development.js';
/** Compact offline-development entry for an existing plugin. Uploading never
 * silently installs a package or changes the active business system. */
export function WorkbenchPackageUpload(props: Omit<WorkbenchUploadSelection, 'version'>) {
  const upload = useMemo(() => createWorkbenchUploadClient(), []);
  const prepare = useMemo(() => createWorkbenchImportPreparationClient(), []);
  const activate = useMemo(() => createWorkbenchActivationClient(), []);
  const install = useMemo(() => createWorkbenchImportClient(), []);
  const developmentClient = useMemo(() => createWorkbenchDevelopmentClient(), []);
  const [development, setDevelopment] = useState<WorkbenchCandidateDevelopment>();
  const [prepared, setPrepared] = useState<WorkbenchImportPreparation>();
  const [operation, setOperation] = useState<WorkbenchImportSelection>();
  const [uncertain, setUncertain] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [file, setFile] = useState<File>();
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  function invalidate() { request.current?.abort(); request.current = undefined; setBusy(false); setMessage(undefined); }
  async function submit() {
    if (!file || !version.trim() || busy) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage(undefined);
    try {
      const baseline = await readWorkbenchCandidateDevelopment(developmentClient, props.developmentId, undefined, controller.signal);
      assertWorkbenchCandidateIdentity(baseline, { package: { packageName: props.packageName }, descriptor: { id: props.workbenchId } });
      const receipt = await upload({ ...props, version: version.trim() }, file, controller.signal);
      const preparation = await prepare(receipt, controller.signal);
      await readWorkbenchCandidateDevelopment(developmentClient, props.developmentId, baseline, controller.signal);
      controller.signal.throwIfAborted();
      if (request.current === controller) { setPrepared(preparation); setDevelopment(baseline); setOperation(undefined); setInstalled(false); }
      controller.signal.throwIfAborted();
      if (request.current === controller) setMessage('插件包核验完成，请确认本次安装。');
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller) {
        const code = cause instanceof Error ? cause.message : '';
        setMessage(code === 'workbench/upload-interrupted' ? '上传连接中断，文件已保留，请重试。' : '上传未完成，请核对插件身份、包版本和文件后重试。');
      }
    } finally {
      if (request.current === controller) { request.current = undefined; setBusy(false); }
    }
  }
  async function confirm(recover = false) {
    if (!prepared || !development || busy || installed) return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      if (!operation) await readWorkbenchCandidateDevelopment(developmentClient, props.developmentId, development, controller.signal);
      const selected = operation ?? Object.freeze({ ...props, version: prepared.package.version, sha256: prepared.package.sha256,
        kind: prepared.kind, expectedInstalledHash: prepared.expectedInstalledHash, operationId: crypto.randomUUID(), iterationId: development.iterationId });
      setOperation(selected);
      const status = await install(selected, recover, controller.signal);
      controller.signal.throwIfAborted();
      if (request.current !== controller) return;
      const success = status.state === 'succeeded'; setInstalled(success);
      setUncertain(['unknown', 'running', 'reconciling'].includes(status.state));
      setMessage(success ? '安装文件已核验。工作台启用状态仍需确认。' : status.state === 'failed' ? '安装未完成，请保留记录并核对失败原因。' : '结果尚未确认，请核对本次安装状态。');
    } catch (cause) {
      if (request.current === controller) {
        if (cause instanceof Error && ['workbench/development-revision-conflict', 'workbench/development-not-found', 'workbench/operation-iteration-conflict'].includes(cause.message)) {
          setPrepared(undefined); setUncertain(false); setMessage('开发需求已变化，请重新上传并核验本轮候选。'); return;
        }
        const missing = cause instanceof Error && cause.message === 'workbench/operation-not-found';
        setUncertain(!missing);
        setMessage(missing ? '宿主未收到这次安装，可使用原操作重试。' : '安装结果未确认，请核对同一次操作，避免重复安装。');
      }
    } finally { if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  async function setEnabled(enabled: boolean) {
    if (!operation || busy || !installed) return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const result = await activate(operation, enabled, controller.signal);
      if (request.current !== controller) return;
      setMessage(result.confirmed ? enabled ? '宿主启用已生效，业务页面仍需检查。' : '宿主停用已生效。' : result.pendingRestart ? '设置已提交，需要重启后再次确认。' : '启停结果未确认，可能受到其他配置影响，请核对。');
    } catch { if (!controller.signal.aborted && request.current === controller) setMessage('启停结果未确认，请刷新管理状态后再操作。'); }
    finally { if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  return <section className="wd-install-upload">
    <h3>选择本机插件包</h3>
    <p>适用于专业开发者提交的 .tgz 包，单个文件不超过 8 MB。</p>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <label>插件包 <input type="file" accept=".tgz,application/gzip" disabled={busy || !!operation} onChange={event => {
        invalidate(); setPrepared(undefined); setFile(event.currentTarget.files?.[0]);
      }} /></label>
      <label>包版本 <input value={version} placeholder="例如 0.1.0" disabled={busy || !!operation} onChange={event => { invalidate(); setPrepared(undefined); setVersion(event.currentTarget.value); }} /></label>
      <button disabled={busy || !!operation || !file || !version.trim()} onClick={() => void submit()}>{busy ? '正在上传…' : '上传并核验'}</button>
      {busy && !operation && <button onClick={() => { invalidate(); setMessage('已取消上传，文件已保留。'); }}>取消</button>}
    </div>
    {prepared && <div style={{ marginTop: 16 }}>
      <p>{prepared.kind === 'update' ? `更新：${prepared.installedVersion} → ${prepared.package.version}` : `首次安装：${prepared.package.version}`}</p>
      {!installed && <button disabled={busy || uncertain} onClick={() => void confirm(false)}>{operation ? '重试同一次安装' : prepared.kind === 'update' ? '确认更新插件' : '确认安装插件'}</button>}
      {installed && <><button disabled={busy} onClick={() => void setEnabled(true)}>启用工作台</button><button disabled={busy} onClick={() => void setEnabled(false)}>停用工作台</button></>}
      {uncertain && <button disabled={busy} onClick={() => void confirm(true)}>核对安装状态</button>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
