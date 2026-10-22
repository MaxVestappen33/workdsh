import { useEffect, useMemo, useRef, useState } from 'react';
import * as React from 'react';
import { Button, Input, Modal, Select, Textarea } from 'workdsh-ui';
import type { ExpertDetail, ExpertListingOptions } from '../shared.js';
import type { ExpertManagementClient } from './management.js';

/**
 * 专家上架申请（对齐后台 `expertListingRequest` / `expertgroupListingRequest`）。
 *
 * 只提交基本信息：包体由 Host 用当前草稿导出的标准 `.expert.zip` 自动上传，用户无需再选文件。
 * 后台 `domain` 为必填（字典 `ai_expert_domain`），因此表单保留「所属领域」，
 * 而 `description` / `useCase` 等字段由当前专家定义自动带入。
 */

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const NODE_GROUPS: ReadonlyArray<readonly [string, string]> = [['self', '本级节点'], ['up', '上级节点'], ['peer', '同级节点'], ['down', '下级节点']];

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : '上架申请提交失败，请重试。';
}

export function ExpertListingModal({ expertId, management, onClose, onSubmitted }: {
  readonly expertId: string;
  readonly management: ExpertManagementClient;
  readonly onClose: () => void;
  readonly onSubmitted: (message: string) => void;
}) {
  const [detail, setDetail] = useState<ExpertDetail>();
  const [options, setOptions] = useState<ExpertListingOptions>();
  const [optionsError, setOptionsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [iconDataUrl, setIconDataUrl] = useState<string>();
  const [iconError, setIconError] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('v1.0.0');
  const [sourceNode, setSourceNode] = useState('');
  const [capability, setCapability] = useState('');
  const [tags, setTags] = useState<readonly string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [owner, setOwner] = useState('');
  const [department, setDepartment] = useState('');
  const [domain, setDomain] = useState('');
  const [isPublic, setIsPublic] = useState('1');
  const [listed, setListed] = useState(true);
  const iconInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await management.get(expertId);
        if (cancelled) return;
        const definition = loaded.revision?.definition ?? loaded.draft.definition;
        setDetail(loaded);
        setName(definition.name);
        setCapability(definition.role);
        setTags(definition.tags);
      } catch (cause) {
        if (!cancelled) setError(messageOf(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [management, expertId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await management.listingOptions();
        if (cancelled) return;
        setOptions(loaded);
        if (!loaded.available) setOptionsError(loaded.reason ?? '后台未接入。');
        const firstPublic = loaded.publicOptions[0];
        if (firstPublic) setIsPublic(current => current || firstPublic.value);
      } catch (cause) {
        if (!cancelled) setOptionsError(messageOf(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [management]);

  const defaultNode = useMemo(() => {
    const nodes = options?.nodes ?? [];
    return nodes.find(node => node.nodeType === 'self') ?? nodes[0];
  }, [options]);
  useEffect(() => {
    if (defaultNode) setSourceNode(current => current || defaultNode.value);
  }, [defaultNode]);
  const defaultDomain = options?.domains[0];
  useEffect(() => {
    if (defaultDomain) setDomain(current => current || defaultDomain.value);
  }, [defaultDomain]);

  const kindLabel = detail?.revision?.definition.team ? '专家团' : '专家';

  const chooseIcon = async (file: File) => {
    setIconError('');
    if (!/^image\/(png|jpeg)$/u.test(file.type) && !/\.(?:png|jpe?g)$/iu.test(file.name)) {
      setIconError('图标仅支持 png、jpg、jpeg 格式。');
      return;
    }
    if (file.size > MAX_ICON_BYTES) { setIconError('图标不得超过 2 MiB。'); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('图标读取失败。'));
      reader.readAsDataURL(file);
    }).catch((cause: unknown) => { setIconError(messageOf(cause)); return ''; });
    if (dataUrl) setIconDataUrl(dataUrl);
  };

  const addTag = () => {
    const value = tagDraft.trim();
    if (!value) return;
    if (!tags.includes(value)) setTags(current => [...current, value]);
    setTagDraft('');
  };

  const validate = (): string | undefined => {
    if (!name.trim()) return '请填写显示名称。';
    if (!sourceNode) return '请选择来源节点。';
    if (!capability.trim()) return '请填写能力说明。';
    if (!owner.trim()) return '请填写负责人。';
    if (!department.trim()) return '请填写所属部门。';
    if (!domain) return '请选择所属领域。';
    if (!isPublic) return '请选择是否公开。';
    return undefined;
  };

  const submit = async () => {
    if (busy) return;
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try {
      const message = await management.submitListing({
        expertId, name: name.trim(), version: version.trim(), sourceNode,
        capability: capability.trim(), tags, owner: owner.trim(), department: department.trim(),
        domain, isPublic, listed,
        ...(iconDataUrl === undefined ? {} : { iconDataUrl }),
      });
      onSubmitted(message);
    } catch (cause) {
      setError(messageOf(cause));
    } finally { setBusy(false); }
  };

  const nodes = options?.nodes ?? [];
  return <Modal open label={`${kindLabel}上架申请`} className="expert-listing-dialog" onClose={() => { if (!busy) onClose(); }}>
    <header className="listing-header">
      <h2>{kindLabel}上架申请</h2>
      <p>提交后进入审批流程，审批通过后可在专家中心安装到本机。</p>
    </header>
    <div className="listing-content">
      <section className="listing-section">
        <h3><i aria-hidden />基础信息</h3>
        <div className="listing-icon-field">
          <div className="listing-icon" aria-hidden>{iconDataUrl ? <img src={iconDataUrl} alt="" /> : (name.trim().charAt(0) || '专')}</div>
          <div>
            <div className="listing-icon-buttons">
              <Button onClick={() => iconInput.current?.click()} disabled={busy}>{iconDataUrl ? '更换图标' : '选择图标'}</Button>
              {iconDataUrl ? <Button onClick={() => setIconDataUrl(undefined)} disabled={busy}>清除</Button> : null}
            </div>
            <small>支持 png、jpg、jpeg，≤2 MiB；不上传时使用名称首字。</small>
            {iconError ? <p className="error" role="alert">{iconError}</p> : null}
          </div>
          <input ref={iconInput} className="visually-hidden" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void chooseIcon(file); event.currentTarget.value = ''; }} />
        </div>

        <div className="listing-grid">
          <label className="listing-field"><span><em>*</em>显示名称</span>
            <Input aria-label="显示名称" maxLength={80} placeholder="请输入专家名称" value={name} onChange={event => setName(event.currentTarget.value)} />
          </label>
          <label className="listing-field"><span>版本</span>
            <Input aria-label="版本" maxLength={64} placeholder="例如 v1.0.0" value={version} onChange={event => setVersion(event.currentTarget.value)} />
          </label>
          <label className="listing-field"><span><em>*</em>来源节点</span>
            <Select aria-label="来源节点" value={sourceNode} onChange={event => setSourceNode(event.currentTarget.value)}>
              <option value="">请选择来源节点</option>
              {NODE_GROUPS.map(([type, label]) => {
                const group = nodes.filter(node => node.nodeType === type);
                return group.length ? <optgroup key={type} label={label}>{group.map(node => <option key={node.value} value={node.value}>{node.label}</option>)}</optgroup> : null;
              })}
            </Select>
            <small>按节点类型分组（本级 / 上级 / 同级 / 下级）</small>
          </label>
          <label className="listing-field"><span><em>*</em>所属领域</span>
            <Select aria-label="所属领域" value={domain} onChange={event => setDomain(event.currentTarget.value)}>
              <option value="">请选择警务领域</option>
              {(options?.domains ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
            <small>后台必填，取自字典 ai_expert_domain。</small>
          </label>
          <label className="listing-field listing-field-wide"><span><em>*</em>能力说明</span>
            <Textarea aria-label="能力说明" className="listing-textarea" maxLength={500} placeholder="描述该智能体专家具备的专业能力" value={capability} onChange={event => setCapability(event.currentTarget.value)} />
            <small className="listing-counter">{capability.length} / 500</small>
          </label>
          <div className="listing-field listing-field-wide"><span>标签</span>
            <div className="listing-tags" onClick={() => undefined}>
              {tags.map(tag => <span className="listing-tag" key={tag}>{tag}<button type="button" aria-label={`移除标签 ${tag}`} onClick={() => setTags(current => current.filter(item => item !== tag))}>×</button></span>)}
              <Input aria-label="标签" placeholder="输入后回车添加标签" maxLength={40} value={tagDraft}
                onChange={event => setTagDraft(event.currentTarget.value)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} />
            </div>
          </div>
          <label className="listing-field"><span><em>*</em>负责人</span>
            <Input aria-label="负责人" maxLength={64} placeholder="请输入负责人" value={owner} onChange={event => setOwner(event.currentTarget.value)} />
          </label>
          <label className="listing-field"><span><em>*</em>所属部门</span>
            <Input aria-label="所属部门" maxLength={64} placeholder="请输入所属部门" value={department} onChange={event => setDepartment(event.currentTarget.value)} />
          </label>
          <div className="listing-field listing-field-wide"><span><em>*</em>是否公开</span>
            <div className="listing-radio-group" role="radiogroup" aria-label="是否公开">
              {(options?.publicOptions.length ? options.publicOptions : [{ value: '1', label: '公开' }, { value: '0', label: '非公开' }]).map(option =>
                <label key={option.value} className="listing-radio">
                  <input type="radio" name="expert-listing-public" value={option.value} checked={isPublic === option.value} onChange={() => setIsPublic(option.value)} />
                  <span>{option.label}</span>
                </label>)}
            </div>
          </div>
          <div className="listing-field listing-field-wide"><span>是否上架</span>
            <label className="listing-switch">
              <input type="checkbox" checked={listed} onChange={event => setListed(event.currentTarget.checked)} />
              <span>{listed ? '是（提交后进入待审批）' : '否（仅保存为草稿）'}</span>
            </label>
          </div>
        </div>
      </section>

      <section className="listing-section">
        <h3><i aria-hidden />文件</h3>
        <p className="listing-file-note">将使用当前{kindLabel}内容自动打包为 .zip 上传，无需手动选择文件。</p>
        {detail && <div className="listing-file">
          <div className="listing-file-main">
            <strong>{detail.revision?.definition.name ?? detail.draft.definition.name}</strong>
            <small>来源：本机草稿 · 格式：.expert.zip</small>
          </div>
        </div>}
      </section>

      {optionsError ? <p className="error" role="alert">表单字典加载失败：{optionsError}</p> : null}
      {!options && !optionsError ? <p className="muted" role="status">正在读取表单字典…</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
    <footer className="listing-footer">
      <Button onClick={onClose} disabled={busy}>取消</Button>
      <Button variant="primary" disabled={busy || !detail} onClick={() => void submit()}>{busy ? '正在提交…' : '申请'}</Button>
    </footer>
  </Modal>;
}
