import {recoverWorkbenchCandidate} from './candidate-recovery.js';
import {packageCheckMessage} from './package-check-message.js';
import { createWorkbenchImportPreparationClient, createWorkbenchOfflinePreparationClient, type WorkbenchImportPreparation } from './prepare-import-client.js';
import { createWorkbenchImportClient, type WorkbenchImportSelection } from './import-client.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWorkbenchPackagePreviewClient } from './package-preview-client.js';
import { createWorkbenchActivationClient } from './activation-client.js';
import { createWorkbenchDevelopmentClient } from './development-client.js';
import { assertWorkbenchCandidateIdentity, readWorkbenchCandidateDevelopment, type WorkbenchCandidateDevelopment } from './candidate-development.js';
import { createWorkbenchNativeInstallationClient } from './native-installation-client.js';
export type WorkbenchCandidatePreview = Awaited<ReturnType<ReturnType<typeof createWorkbenchPackagePreviewClient>>>;
type PreparedCandidate = WorkbenchImportPreparation & { readonly developmentId: string; readonly iterationId?: string };
export function WorkbenchPackagePreview(props: { onClose: () => void; onRefresh: () => Promise<void>; canOpen?: (id: string) => boolean; onOpen?: (id: string) => void; candidate?: WorkbenchCandidatePreview; development?: WorkbenchCandidateDevelopment }) {
  const activate = useMemo(() => createWorkbenchActivationClient(), []);
  const [enabled, setEnabled] = useState(false);
  const preview = useMemo(() => createWorkbenchPackagePreviewClient(), []);
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<Awaited<ReturnType<ReturnType<typeof createWorkbenchPackagePreviewClient>>>>();
  const prepareDevelopment = useMemo(() => createWorkbenchImportPreparationClient(), []);
  const prepareOffline = useMemo(() => createWorkbenchOfflinePreparationClient(), []);
  const developmentClient = useMemo(() => createWorkbenchDevelopmentClient(), []);
  const install = useMemo(() => createWorkbenchImportClient(), []);
  const verifyNative = useMemo(() => createWorkbenchNativeInstallationClient(), []);
  const [prepared, setPrepared] = useState<PreparedCandidate>();
  const [operation, setOperation] = useState<WorkbenchImportSelection>();
  const [uncertain, setUncertain] = useState(false), [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const pending = useRef(false);
  async function prepareCandidate(value: WorkbenchCandidatePreview, signal: AbortSignal): Promise<PreparedCandidate> {
    if (props.candidate) {
      if (!props.development) throw new Error('workbench/development-source-unavailable');
      const development = await readWorkbenchCandidateDevelopment(developmentClient, props.development.id, props.development, signal);
      assertWorkbenchCandidateIdentity(development, value);
      const prepared = await prepareDevelopment({ ...value.package, workbenchId: value.descriptor.id, developmentId: development.id }, signal);
      return Object.freeze({ ...prepared, developmentId: development.id, iterationId: development.iterationId });
    }
    const prepared = await prepareOffline({ ...value.package, workbenchId: value.descriptor.id }, signal);
    return Object.freeze({ ...prepared, developmentId: prepared.importId });
  }
  useEffect(() => () => { request.current?.abort(); request.current = undefined; }, []);
  useEffect(() => {
    if (!props.candidate) return;
    const value = props.candidate, controller = new AbortController(); request.current = controller;
    setResult(value);setPrepared(undefined);setInstalled(false);setEnabled(false);setMessage(undefined);setOperation(undefined);setUncertain(false); setBusy(true); pending.current = true;
    void (async () => {
      try { if (value.compatible) {
        const outcome=props.development?await recoverWorkbenchCandidate(async()=>{
          await readWorkbenchCandidateDevelopment(developmentClient,props.development!.id,props.development,controller.signal);
          await verifyNative({developmentId:props.development!.id,expectedRevision:props.development!.revision,...value.package,workbenchId:value.descriptor.id},controller.signal);
        },()=>prepareCandidate(value,controller.signal),controller.signal):{kind:'prepared' as const,prepared:await prepareCandidate(value,controller.signal)};
        if(controller.signal.aborted||request.current!==controller)return;
        if(outcome.kind==='recovered'){setInstalled(true);setUncertain(false);setMessage('检测到本版本已经安装，实际文件已核验。无需重复安装，可继续启用和试用。');}
        else setPrepared(outcome.prepared);
      } }
      catch(cause) { if (!controller.signal.aborted) setMessage(packageCheckMessage(cause instanceof Error?cause.message:undefined)); }
      finally { if (request.current === controller) { request.current=undefined;pending.current=false;setBusy(false); } }
    })();
    return () => controller.abort();
  }, [props.candidate, props.development, prepareDevelopment, prepareOffline, developmentClient, verifyNative]);
  async function inspect() {
    if (!file || pending.current || operation) return;
    pending.current = true;
    const controller = new AbortController(); request.current = controller; setBusy(true); setMessage(undefined); setResult(undefined); setPrepared(undefined);
    try { const value = await preview(file, controller.signal); controller.signal.throwIfAborted(); if (!value.compatible) { if (request.current === controller) setResult(value); return; }
      const candidate = await prepareCandidate(value,controller.signal);
      controller.signal.throwIfAborted();
      if (request.current === controller) { setResult(value); setPrepared(candidate); } }
    catch (cause) { if (!controller.signal.aborted && request.current === controller) setMessage(packageCheckMessage(cause instanceof Error ? cause.message : undefined)); }
    finally { pending.current = false; if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  async function confirm(recover = false) {
    if (!prepared || !result || pending.current || installed) return;
    pending.current = true;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      if (!operation && props.development) {
        await readWorkbenchCandidateDevelopment(developmentClient, props.development.id, props.development, controller.signal);
        assertWorkbenchCandidateIdentity(props.development, result);
      }
      const selected = operation ?? Object.freeze({developmentId:prepared.developmentId,operationId:crypto.randomUUID(),iterationId:prepared.iterationId ?? crypto.randomUUID(),
        ...prepared.package,workbenchId:result.descriptor.id,kind:prepared.kind,expectedInstalledHash:prepared.expectedInstalledHash});
      setOperation(selected);
      const status = await install(selected,recover,controller.signal);
      if (request.current !== controller) return;
      setInstalled(status.state === 'succeeded');setUncertain(['running','reconciling','unknown'].includes(status.state));
      setMessage(status.state === 'succeeded' ? '安装文件已核验，请刷新工作台列表并确认启用状态。' : status.state === 'failed' ? '安装失败，操作记录已保留。' : '安装结果未确认，请核对本次操作。');
    } catch(cause) {
      if (request.current === controller && !controller.signal.aborted) {
        if (cause instanceof Error && ['workbench/development-revision-conflict', 'workbench/development-not-found', 'workbench/development-source-unavailable', 'workbench/package-identity-mismatch', 'workbench/operation-iteration-conflict'].includes(cause.message)) {
          setPrepared(undefined); setUncertain(false); setMessage('开发需求或源码关联已变化，请返回并重新检查候选版本。'); return;
        }
        const missing = cause instanceof Error && cause.message === 'workbench/operation-not-found';
        setUncertain(!missing);setMessage(missing ? '尚未收到安装请求，可重试原操作。' : '结果未确认，请核对原操作，避免重复安装。');
      }
    } finally { pending.current = false; if (request.current === controller) {request.current = undefined;setBusy(false);} }
  }
  async function enable() {
    if (!result || !installed || pending.current) return;
    const selection = operation ?? (props.development && { developmentId: props.development.id, ...result.package, workbenchId: result.descriptor.id });
    if (!selection) return;
    pending.current = true;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const state = await activate(selection, true, controller.signal);
      controller.signal.throwIfAborted();
      if (request.current !== controller) return;
      setEnabled(state.confirmed);
      setMessage(state.confirmed ? '已选择启用。请核对工作台列表中的活动版本，页面加载完成后可打开。' : state.pendingRestart ? '新版需要重启后生效，请重启后从工作台列表打开。' : '启用尚未确认，请核对工作台列表。');
      await props.onRefresh();
    } catch { if (!controller.signal.aborted && request.current === controller) setMessage('启用未确认，请返回列表核对状态。'); }
    finally { pending.current = false; if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  async function verifyNativeResult() {
    if (!result || !props.development || pending.current) return;
    pending.current = true; const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      await readWorkbenchCandidateDevelopment(developmentClient, props.development.id, props.development, controller.signal);
      await verifyNative({ developmentId: props.development.id, expectedRevision: props.development.revision, ...result.package, workbenchId: result.descriptor.id }, controller.signal);
      if (request.current !== controller) return;
      setInstalled(true); setUncertain(false); setMessage('原生安装文件已核验，可以启用并检查工作台。');
      await props.onRefresh();
    } catch(cause) { if (!controller.signal.aborted && request.current === controller) setMessage(packageCheckMessage(cause instanceof Error?cause.message:undefined)); }
    finally { pending.current = false; if (request.current === controller) { request.current = undefined; setBusy(false); } }
  }
  return <section aria-label="导入插件包" className="wd-install-preview">
    <header style={{ display: 'flex', justifyContent: 'space-between' }}><h2>{props.candidate ? '确认安装版本' : '导入插件包'}</h2><button onClick={() => { request.current?.abort(); props.onClose(); }}>{props.candidate?'返回版本列表':'关闭'}</button></header>
    <p>{props.candidate ? '核对以下版本信息，确认后安装到本机。' : '选择开发者提供的 .tgz 文件，系统会自动识别工作台信息。预览不会安装或启用。'}</p>
    {!props.candidate && <><input aria-label="选择插件包" type="file" accept=".tgz,application/gzip" disabled={busy || !!operation} onChange={event => { if (pending.current || operation) return; setFile(event.currentTarget.files?.[0]); setResult(undefined); setPrepared(undefined); setMessage(undefined); }} />
    <button disabled={busy || !file || !!operation} onClick={() => void inspect()}>{busy ? '正在检查…' : '检查插件包'}</button></>}
    {result && <div><h3>{result.descriptor.title}</h3><p>{result.descriptor.description}</p><p>版本 {result.package.version} · {result.compatible ? '内核兼容' : '与当前内核不兼容'}</p><p>{installed ? '插件安装已核验。' : '插件包已核验；安装状态待核对。'}</p>
      {props.development && !installed && result.compatible && <button disabled={busy || !!operation} onClick={() => void verifyNativeResult()}>AI 已安装？核对结果</button>}
      {prepared && !installed && <><p>安装前已检查包结构、声明依赖版本及可静态读取的工具参数；完整启动和页面操作将在安装启用后核对。动态生成的工具定义仍需启动验证。</p><p>{prepared.kind === 'update' ? `更新 ${prepared.installedVersion} → ${prepared.package.version}` : '首次安装'}</p>
      <button data-variant="primary" disabled={busy || uncertain} onClick={() => void confirm(false)}>{operation ? '重试原操作' : prepared.kind === 'update' ? '更新并试用' : '安装试用'}</button>
      {uncertain && <button disabled={busy} onClick={() => void confirm(true)}>核对安装状态</button>}</>}</div>}
    {message && <p role="alert">{message}</p>}
    {installed && result && <div style={{display:'flex',gap:12,marginTop:16}}>
      <button disabled={busy || enabled} onClick={() => void enable()}>启用工作台</button>
      {props.canOpen && props.onOpen && <button disabled={busy || !enabled || !props.canOpen(result.descriptor.id)} onClick={() => props.onOpen?.(result.descriptor.id)}>打开工作台</button>}
      <button disabled={busy} onClick={props.onClose}>{props.candidate ? '返回候选版本' : '返回工作台列表'}</button>
    </div>}
  </section>;
}
