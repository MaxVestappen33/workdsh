import { Button, Icon, Input, Select, Textarea } from 'workdsh-ui';
import { Modal } from 'workdsh-ui';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import type { SkillListingOptions, SkillSceneNode, StagedSkillImport } from '../shared.js';
import type { SkillManagementClient } from './management.js';

type SkillListingModalProps = {
  readonly open: boolean;
  readonly management: SkillManagementClient;
  /** 表单字典：技能类型、来源节点与业务场景树；未就绪时表单只做展示。 */
  readonly options?: SkillListingOptions;
  readonly optionsError?: string;
  readonly onReloadOptions: () => void;
  readonly onClose: () => void;
  /** 提交成功：由面板刷新「我的申请」并切换页签。 */
  readonly onSubmitted: () => Promise<void> | void;
};

const maximumBytes = 50 * 1024 * 1024;
const maximumIconBytes = 2 * 1024 * 1024;
/** 英文名称：字母开头，仅字母、数字、下划线和中划线（与后台口径一致）。 */
const nameEnPattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/u;
const iconTypes = new Set(['image/png', 'image/jpeg']);
/** 来源节点按图二分组展示：本级 / 上级 / 同级 / 下级。 */
const nodeGroups = [['self', '本级节点'], ['up', '上级节点'], ['peer', '同级节点'], ['down', '下级节点']] as const;

function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : '技能上架申请失败，请重试。'; }
function sizeOf(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`; }

/** 单文件直传；多文件或文件夹在渲染层打包成 zip，与本地预检的限制保持一致。 */
async function packageSelection(files: FileList | readonly File[], signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  const selected = [...files];
  if (!selected.length) throw new Error('请选择技能文件。');
  if (selected.length === 1 && !selected[0].webkitRelativePath) return selected[0];
  if (selected.length > 400) throw new Error('技能目录最多包含 400 个文件。');
  const total = selected.reduce((sum, file) => sum + file.size, 0);
  if (total > maximumBytes) throw new Error('技能目录不得超过 50 MiB。');
  const entries: Record<string, Uint8Array> = {};
  for (const file of selected) {
    signal.throwIfAborted();
    const path = file.webkitRelativePath || file.name;
    entries[path] = new Uint8Array(await file.arrayBuffer());
  }
  signal.throwIfAborted();
  return new File([zipSync(entries, { level: 6 })], 'skill-directory.zip', { type: 'application/zip' });
}

/** 从树里建立 id → 名称索引，用于已选标签与详情展示。 */
function labelIndex(nodes: readonly SkillSceneNode[], into = new Map<string, string>()): Map<string, string> {
  for (const node of nodes) { into.set(node.value, node.label); labelIndex(node.children, into); }
  return into;
}

export function SkillListingModal({ open, management, options, optionsError, onReloadOptions, onClose, onSubmitted }: SkillListingModalProps) {
  const [staged, setStaged] = useState<StagedSkillImport>();
  const [dragging, setDragging] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [iconUrl, setIconUrl] = useState<string>();
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState('');
  const [skillName, setSkillName] = useState('');
  const [skillNameEn, setSkillNameEn] = useState('');
  const [skillVersion, setSkillVersion] = useState('v1.0.0');
  const [skillType, setSkillType] = useState('');
  const [sceneIds, setSceneIds] = useState<readonly string[]>([]);
  const [sourceNode, setSourceNode] = useState('');
  const [skillDescr, setSkillDescr] = useState('');
  const [tags, setTags] = useState<readonly string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [isPublic, setIsPublic] = useState('');
  const [reason, setReason] = useState('');
  const [sceneOpen, setSceneOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const tagInput = useRef<HTMLInputElement>(null);
  const sceneWrap = useRef<HTMLDivElement>(null);
  const operationAbort = useRef<AbortController | undefined>(undefined);

  const sceneLabels = useMemo(() => labelIndex(options?.scenes ?? []), [options?.scenes]);
  /** 来源节点默认选中「本级节点」；没有本级时退回第一个可选节点。 */
  const defaultNode = useMemo(() => {
    const nodes = options?.nodes ?? [];
    return nodes.find(node => node.nodeType === 'self') ?? nodes[0];
  }, [options?.nodes]);
  useEffect(() => {
    if (!open || !defaultNode) return;
    setSourceNode(current => current || defaultNode.value);
  }, [open, defaultNode]);
  /** 是否公开默认选中字典第一项（通常是「是」）。 */
  useEffect(() => {
    if (!open) return;
    const first = options?.publicOptions[0];
    if (first) setIsPublic(current => current || first.value);
  }, [open, options]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!sceneWrap.current?.contains(event.target as Node)) setSceneOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  // 关闭或卸载时清理暂存：提交成功由宿主删除，这里的失败不影响结果。
  useEffect(() => () => { operationAbort.current?.abort(); if (staged) void management.discardImport(staged.id).catch(() => {}); }, [management, staged]);

  const reset = () => {
    setStaged(undefined); setDragging(false); setError(''); setBusy(false); setFileBusy(false);
    setIconUrl(undefined); setIconError(''); setIconBusy(false);
    setSkillName(''); setSkillNameEn(''); setSkillVersion('v1.0.0'); setSkillType('');
    setSceneIds([]); setSourceNode(''); setSkillDescr(''); setTags([]); setTagDraft(''); setIsPublic(''); setReason('');
    setSceneOpen(false); setCollapsed([]);
  };
  const close = () => {
    if (busy || fileBusy) return;
    operationAbort.current?.abort();
    const current = staged;
    reset();
    if (current) void management.discardImport(current.id).catch(() => {});
    onClose();
  };

  const inspect = async (files: FileList | readonly File[]) => {
    setFileBusy(true); setError('');
    const controller = new AbortController(); operationAbort.current?.abort(); operationAbort.current = controller;
    try {
      if (staged) await management.discardImport(staged.id).catch(() => {});
      const upload = await packageSelection(files, controller.signal);
      if (upload.size > maximumBytes) throw new Error('技能包不得超过 50 MiB。');
      const next = await management.stageImport(upload, controller.signal);
      setStaged(next);
      // 预检通过后用 SKILL.md 的信息补空，用户仍可修改。
      setSkillNameEn(current => current.trim() ? current : next.inspection.name);
      setSkillDescr(current => current.trim() ? current : next.inspection.description);
    } catch (cause) {
      setStaged(undefined);
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(messageOf(cause));
    } finally {
      if (operationAbort.current === controller) operationAbort.current = undefined;
      setFileBusy(false);
    }
  };
  const chooseIcon = async (file: File) => {
    setIconError('');
    if (!iconTypes.has(file.type) && !/\.(?:png|jpe?g)$/iu.test(file.name)) { setIconError('图标仅支持 png、jpg、jpeg 格式。'); return; }
    if (file.size > maximumIconBytes) { setIconError('图标不得超过 2 MiB。'); return; }
    setIconBusy(true);
    try { setIconUrl((await management.uploadListingIcon(file)).url); }
    catch (cause) { setIconError(messageOf(cause)); }
    finally { setIconBusy(false); }
  };
  const addTag = () => {
    const value = tagDraft.trim();
    if (!value) return;
    if (!tags.includes(value)) setTags(current => [...current, value]);
    setTagDraft('');
  };
  /** 业务场景多选：父级与子级各自独立，不做级联，便于只选某个父节点加一个子节点。 */
  const toggleScene = (node: SkillSceneNode) => {
    const id = node.value;
    setSceneIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };
  const validate = (): string | undefined => {
    if (!staged) return '请先选择并预检技能文件。';
    if (!skillName.trim()) return '请填写技能名称。';
    if (!nameEnPattern.test(skillNameEn.trim())) return '英文名称需以字母开头，仅支持字母、数字、下划线和中划线。';
    if (!skillVersion.trim()) return '请填写版本号。';
    if (!skillType) return '请选择 Skill 类型。';
    if (!sceneIds.length) return '请选择所属业务场景。';
    if (!sourceNode) return '请选择来源节点。';
    if (!skillDescr.trim()) return '请填写技能描述。';
    if (skillDescr.length > 1000) return '描述不得超过 1000 字。';
    if (!isPublic) return '请选择是否公开。';
    if (!reason.trim()) return '请填写上架原因。';
    return undefined;
  };
  const submit = async () => {
    if (!staged || busy) return;
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    const controller = new AbortController(); operationAbort.current?.abort(); operationAbort.current = controller;
    try {
      await management.submitListing({
        skillName: skillName.trim(),
        skillNameEn: skillNameEn.trim(),
        skillVersion: skillVersion.trim(),
        skillType,
        bizScene: sceneIds.join(','),
        sourceNode,
        skillDescr: skillDescr.trim(),
        customTag: tags.join(','),
        reason: reason.trim(),
        isPublic,
        ...(iconUrl ? { icon: iconUrl } : {}),
        stagedId: staged.id,
      }, controller.signal);
      reset();
      onClose();
      await onSubmitted();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      if (operationAbort.current === controller) operationAbort.current = undefined;
      setBusy(false);
    }
  };

  const renderSceneNode = (node: SkillSceneNode, depth: number): React.ReactNode => {
    const checked = sceneIds.includes(node.value);
    const hasChildren = node.children.length > 0;
    const expanded = !collapsed.includes(node.value);
    return <div key={node.value} className="scene-node">
      <div className="scene-row" style={{ paddingLeft: depth * 22 }}>
        {hasChildren
          ? <button type="button" className={`scene-expand${expanded ? ' open' : ''}`} aria-label={`${expanded ? '收起' : '展开'} ${node.label}`} onClick={() => setCollapsed(current => expanded ? [...current, node.value] : current.filter(id => id !== node.value))}><Icon name="chevron" size={13} /></button>
          : <span className="scene-expand placeholder" aria-hidden />}
        <label className="scene-label">
          <input type="checkbox" checked={checked} onChange={() => toggleScene(node)} />
          <span>{node.label}</span>
        </label>
      </div>
      {hasChildren && expanded ? node.children.map(child => renderSceneNode(child, depth + 1)) : null}
    </div>;
  };

  const selectedSceneLabels = sceneIds.map(id => sceneLabels.get(id)).filter((label): label is string => Boolean(label));
  const nodes = options?.nodes ?? [];
  return <Modal open={open} label="技能上架申请" className="skill-listing-dialog" onClose={close}>
    <header className="listing-header"><h2>技能上架申请</h2><p>提交后进入审批流程，审批通过后可在「技能市场」安装到本机。</p></header>
    <div className="listing-content">
      <section className="listing-section">
        <h3><i aria-hidden />基础信息</h3>
        <div className="listing-icon-field">
          <div className="listing-icon" aria-hidden>{iconUrl ? <img src={iconUrl} alt="" /> : (skillName.trim().charAt(0) || '技')}</div>
          <div className="listing-icon-actions">
            <div className="listing-icon-buttons">
              <Button onClick={() => iconInput.current?.click()} disabled={iconBusy || busy || !open}>{iconBusy ? '正在上传…' : '选择图标'}</Button>
              {iconUrl ? <Button onClick={() => setIconUrl(undefined)} disabled={iconBusy || busy}>清除</Button> : null}
            </div>
            <small>支持 png、jpg、jpeg，≤2 MiB；不上传时使用名称首字。</small>
            {iconError ? <p className="error" role="alert">{iconError}</p> : null}
          </div>
          <input ref={iconInput} className="visually-hidden" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void chooseIcon(file); event.currentTarget.value = ''; }} />
        </div>
        <div className="listing-grid">
          <label className="listing-field"><span>技能名称 <em>*</em></span><Input aria-label="技能名称" placeholder="请输入技能名称" maxLength={200} value={skillName} onChange={event => setSkillName(event.currentTarget.value)} /></label>
          <label className="listing-field"><span>英文名称 <em>*</em></span><Input aria-label="英文名称" placeholder="英文名称需以字母开头，仅支持字母、数字、下划线和中划线" maxLength={200} value={skillNameEn} onChange={event => setSkillNameEn(event.currentTarget.value)} /><small>创建后不可修改</small></label>
          <label className="listing-field"><span>版本号 <em>*</em></span><Input aria-label="版本号" placeholder="例如 v1.0.0" maxLength={64} value={skillVersion} onChange={event => setSkillVersion(event.currentTarget.value)} /></label>
          <label className="listing-field"><span>Skill 类型 <em>*</em></span><Select aria-label="Skill 类型" value={skillType} onChange={event => setSkillType(event.currentTarget.value)}><option value="">请选择 Skill 类型</option>{(options?.skillTypes ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>
          <div className="listing-field"><span>所属业务场景 <em>*</em></span>
            <div className="scene-select" ref={sceneWrap}>
              <button type="button" className={`scene-trigger${sceneOpen ? ' open' : ''}`} aria-haspopup="tree" aria-expanded={sceneOpen} onClick={() => setSceneOpen(value => !value)}>
                <span className={selectedSceneLabels.length ? '' : 'placeholder'}>{selectedSceneLabels.length ? selectedSceneLabels.join('、') : '请选择业务场景（可含一级）'}</span>
                <Icon name="chevron" size={14} />
              </button>
              {sceneOpen ? <div className="scene-panel" role="tree" aria-label="业务场景">
                {(options?.scenes ?? []).length ? (options?.scenes ?? []).map(node => renderSceneNode(node, 0)) : <p className="muted">暂无可选业务场景。</p>}
              </div> : null}
            </div>
            <small>可多选；父级与子级独立选择，不做级联。</small>
          </div>
          <label className="listing-field"><span>来源节点 <em>*</em></span>
            <Select aria-label="来源节点" value={sourceNode} onChange={event => setSourceNode(event.currentTarget.value)}>
              {nodeGroups.map(([type, label]) => {
                const group = nodes.filter(node => node.nodeType === type);
                return group.length ? <optgroup key={type} label={label}>{group.map(node => <option key={node.value} value={node.value}>{node.label}</option>)}</optgroup> : null;
              })}
            </Select>
            <small>按节点类型分组（本级 / 上级 / 同级 / 下级）</small>
          </label>
          <label className="listing-field listing-field-wide"><span>描述 <em>*</em></span><Textarea aria-label="描述" className="listing-textarea" maxLength={1000} placeholder="请输入技能的功能描述" value={skillDescr} onChange={event => setSkillDescr(event.currentTarget.value)} /><small className="listing-counter">{skillDescr.length} / 1000</small></label>
          <div className="listing-field listing-field-wide"><span>自定义标签</span>
            <div className="listing-tags" onClick={() => tagInput.current?.focus()}>
              {tags.map(tag => <span className="listing-tag" key={tag}>{tag}<button type="button" aria-label={`移除标签 ${tag}`} onClick={() => setTags(current => current.filter(item => item !== tag))}>×</button></span>)}
              <Input ref={tagInput} aria-label="自定义标签" placeholder="输入后回车添加标签" maxLength={40} value={tagDraft} onChange={event => setTagDraft(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} />
            </div>
          </div>
          <div className="listing-field listing-field-wide"><span>是否公开 <em>*</em></span>
            <div className="listing-radio-group" role="radiogroup" aria-label="是否公开">
              {(options?.publicOptions ?? []).map(option => <label key={option.value} className="listing-radio"><input type="radio" name="listing-public" value={option.value} checked={isPublic === option.value} onChange={() => setIsPublic(option.value)} /><span>{option.label}</span></label>)}
            </div>
          </div>
          <label className="listing-field listing-field-wide"><span>上架原因 <em>*</em></span><Textarea aria-label="上架原因" className="listing-textarea" maxLength={2000} placeholder="请说明本次上架的原因" value={reason} onChange={event => setReason(event.currentTarget.value)} /></label>
        </div>
      </section>
      <section className="listing-section">
        <h3><i aria-hidden />配置</h3>
        <div className="listing-field">
          <span>Skill 文件 <em>*</em></span>
          {staged ? <div className="listing-file" data-testid="skill-listing-review">
            <div className="listing-file-main"><strong>{staged.fileName}</strong><small>{staged.inspection.files.length} 个文件 · {sizeOf(staged.inspection.totalBytes)}</small><small className="slug">{staged.inspection.name}</small></div>
            <Button onClick={() => { fileInput.current?.click(); }} disabled={busy || fileBusy}>重新选择</Button>
          </div> : <button type="button" className={`listing-dropzone${dragging ? ' dragging' : ''}`} disabled={fileBusy || busy}
            onClick={() => fileInput.current?.click()}
            onDragEnter={event => { event.preventDefault(); setDragging(true); }}
            onDragOver={event => event.preventDefault()}
            onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={event => { event.preventDefault(); setDragging(false); void inspect(event.dataTransfer.files); }}>
            <span className="upload-glyph" aria-hidden>↥</span>
            <strong>{fileBusy ? '正在上传并预检…' : '拖拽文件或点击上传'}</strong>
            <small>仅可上传 1 个 .md 或 .zip 文件</small>
          </button>}
          <input ref={fileInput} className="visually-hidden" type="file" accept=".zip,.md,text/markdown,application/zip" onChange={event => { if (event.currentTarget.files) void inspect(event.currentTarget.files); event.currentTarget.value = ''; }} />
          <input ref={folderInput} className="visually-hidden" type="file" multiple {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={event => { if (event.currentTarget.files) void inspect(event.currentTarget.files); event.currentTarget.value = ''; }} />
          {!staged ? <div className="listing-file-actions">{fileBusy ? <Button onClick={() => operationAbort.current?.abort()}>取消上传</Button> : <Button onClick={() => folderInput.current?.click()} disabled={busy}>选择技能文件夹</Button>}</div> : null}
          <small>压缩包或文件夹内必须且只能包含一个 SKILL.md；最多 50 MiB、400 个文件、6 层资源目录。</small>
        </div>
      </section>
      {optionsError ? <p className="error" role="alert">表单字典加载失败：{optionsError}<Button onClick={onReloadOptions}>重试</Button></p> : null}
      {!options && !optionsError ? <p className="muted" role="status">正在读取表单字典…</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
    <footer className="listing-footer"><Button onClick={close} disabled={busy || fileBusy}>取消</Button><Button variant="primary" className="listing-submit" disabled={busy || fileBusy || !staged} onClick={() => void submit()}>{busy ? '正在提交…' : '保存并上架'}</Button></footer>
  </Modal>;
}
