import { Button, Select } from 'workdsh-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as React from 'react';
import type { MyListingSummary } from '../shared.js';
import type { ExpertManagementClient } from './management.js';

/**
 * 「我的申请」：当前成员提交过审核的专家/专家团台账。
 *
 * 数据来自后台 `queryMyListingExpertList` / `queryMyListingExpertGroupList`，不按状态过滤，
 * 由界面按 status 展示徽标（草稿 / 待审批 / 已上架 / 已驳回 / 已下架），并按审批状态就地筛选。
 * 这是后台台账，不与本地专家记录做行级映射。
 */

interface MyApplicationsProps {
  readonly management: ExpertManagementClient;
  readonly kind: 'agent' | 'team';
  readonly keyword: string;
  /** Bumped by the panel's 刷新 button. */
  readonly reloadKey?: number;
}

const STATUS_TONE: Readonly<Record<string, string>> = {
  '1': '', '2': 'warn', '3': 'ready', '4': 'bad', '5': '',
};

/** 审批状态筛选项：与后台台账的 status 码一致。 */
const STATUS_OPTIONS = [
  ['1', '草稿'], ['2', '待审批'], ['3', '已上架'], ['4', '已驳回'], ['5', '已下架'],
] as const;

/** 只有待审批的申请显示「撤回」入口；当前仅作展示，不绑定操作。 */
const WITHDRAWABLE_STATUS = '2';

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : '读取上架申请失败，请重试。';
}

export function MyApplications({ management, kind, keyword, reloadKey = 0 }: MyApplicationsProps) {
  const [items, setItems] = useState<readonly MyListingSummary[]>([]);
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string>();
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  /** 审批状态筛选：空串表示全部；台账一次取回全部状态，筛选在本地完成。 */
  const [statusFilter, setStatusFilter] = useState('');
  const sequence = useRef(0);
  const kindLabel = kind === 'team' ? '专家团' : '专家';

  useEffect(() => {
    const current = ++sequence.current;
    setBusy(true); setError('');
    void (async () => {
      try {
        const result = await management.myListings({ expertType: kind, pageNo: 1, pageSize: 100, ...(keyword ? { keyword } : {}) });
        if (current !== sequence.current) return;
        setAvailable(result.available);
        setReason(result.reason);
        setItems(result.items);
        setTotal(result.total);
      } catch (cause) {
        if (current !== sequence.current) return;
        setAvailable(false);
        setReason(messageOf(cause));
        setItems([]); setTotal(0);
      } finally {
        if (current === sequence.current) setBusy(false);
      }
    })();
  }, [management, kind, keyword, reloadKey]);

  const visible = useMemo(
    () => (statusFilter ? items.filter(item => item.status === statusFilter) : items),
    [items, statusFilter],
  );
  const statusLabel = STATUS_OPTIONS.find(([value]) => value === statusFilter)?.[1];

  const summary = useMemo(() => {
    if (items.length === 0) return '';
    const scope = statusLabel ? `（审批状态：${statusLabel}）` : '';
    return `共 ${total} 条${kindLabel}申请 · 当前显示 ${visible.length} 条${scope}`;
  }, [items.length, total, visible.length, kindLabel, statusLabel]);

  if (busy) return <div className="remote-status" role="status" aria-live="polite"><span className="muted">正在读取我的申请…</span></div>;
  if (!available) {
    return <div className="empty">
      <strong>上架申请不可用</strong>
      <span className="muted">{reason || '当前未接入业务后台。'}</span>
    </div>;
  }

  return <>
    <div className="application-toolbar">
      <label className="application-status-filter">
        <span>审批状态</span>
        <Select aria-label="审批状态" value={statusFilter} onChange={event => setStatusFilter(event.currentTarget.value)}>
          <option value="">全部</option>
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </label>
    </div>
    <div role="status" aria-live="polite" className={error ? 'error counts' : 'counts'}>{error || summary}</div>
    {visible.length === 0
      ? <div className="empty">
        <strong>{keyword ? `没有匹配的${kindLabel}申请` : statusLabel ? `没有「${statusLabel}」的申请` : `还没有提交过${kindLabel}上架申请`}</strong>
        <span className="muted">{keyword || statusLabel ? '换个关键词或审批状态再试。' : '在「我的专家」里点「申请上架」即可提交审核。'}</span>
      </div>
      : <div className="grid">{visible.map(item => {
        const tone = STATUS_TONE[item.status] ?? '';
        const key = `${item.expertType}-${item.remoteId}`;
        return <article className="card application-card" key={key}>
          <div className="card-top">
            <div className="card-open">
              <span className="avatar" aria-hidden>{item.name.trim().charAt(0) || '专'}</span>
              <span className="card-title">
                <strong title={item.name}>{item.name}</strong>
                <span className="card-meta">{item.domain || kindLabel}</span>
              </span>
            </div>
          </div>
          <p className="desc">{item.description || <span className="muted">（暂无简介）</span>}</p>
          <div className="domain-tags">{(item.tags ?? []).slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>
          {item.listingReason && <p className="application-note">上架说明：{item.listingReason}</p>}
          {item.status === '4' && item.offlineReason && <p className="application-note error-text">驳回原因：{item.offlineReason}</p>}
          {item.status === '5' && item.offlineReason && <p className="application-note">下架原因：{item.offlineReason}</p>}
          <div className="card-foot">
            <span className="badge">{kindLabel}</span>
            <span className={`badge ${tone}`}>{item.statusLabel}</span>
            <span className="muted">{item.version}</span>
            {/* 撤回入口只做展示，不绑定操作。 */}
            {item.status === WITHDRAWABLE_STATUS && <Button size="sm" className="application-withdraw">撤回</Button>}
          </div>
        </article>;
      })}</div>}
  </>;
}
