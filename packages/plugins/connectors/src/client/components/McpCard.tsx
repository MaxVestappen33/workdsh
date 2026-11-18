import { useState, type MouseEvent } from 'react';
import type { ConnectorApplyStatus, MarketItem } from '../../market.js';
import type { ConnectorSummary } from '../../shared.js';

export const connectorStateLabels = {
  ready: '已连接',
  discovering: '正在连接',
  offline: '连接异常',
  disabled: '已停用',
} as const;

/** 申请状态文案：与后台 applyStatus 一一对应；授权状态是独立标签，不参与这里。 */
export const APPLY_LABEL: Record<ConnectorApplyStatus, string> = {
  none: '未申请',
  pending: '申请中',
  approved: '已通过',
  rejected: '未通过',
};

/** 卡片图标：`icon` 为 http(s) 图标地址，`color` 为底色；缺失或加载失败时回退首字符。 */
export type ConnectorMark = { readonly label: string; readonly icon?: string; readonly color?: string };

/** 统计值展示：万级以上按「x.xxw」压缩，与市场列表口径一致。 */
export function formatMarketCount(value: number): string {
  if (value < 10_000) return String(value);
  return `${(value / 10_000).toFixed(2).replace(/\.?0+$/, '')}w`;
}

/** 市场条目图标：后台的 icon 是 http URL，加载失败或为空时退回名称首字符 + color 底色。 */
export function marketMark(entry: MarketItem): ConnectorMark {
  return {
    label: entry.title.trim().charAt(0).toUpperCase(),
    ...(entry.icon ? { icon: entry.icon } : {}),
    ...(entry.color ? { color: entry.color } : {}),
  };
}

/** 订阅来源实例沿用市场条目图标，自建实例用首字母 + 品牌渐变兜底。 */
export function localMark(row: ConnectorSummary, market: readonly MarketItem[] = []): ConnectorMark {
  const source = row.originId ? market.find(entry => entry.originId === row.originId) : undefined;
  if (source) return marketMark(source);
  return { label: row.title.trim().charAt(0).toUpperCase() };
}

export function McpMark({ label, icon, color, large }: ConnectorMark & { large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const className = `mark${large ? ' large' : ''}${color ? '' : ' fallback'}`;
  const style = color ? { background: color } : undefined;
  if (icon && !failed) {
    return <span className={className} style={style} aria-hidden><img src={icon} alt="" onError={() => setFailed(true)} /></span>;
  }
  return <span className={className} style={style} aria-hidden>{label}</span>;
}

function Glyph({ paths, size = 16 }: { paths: readonly string[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      {paths.map(path => <path key={path} d={path} />)}
    </svg>
  );
}

const glyphs = {
  trash: ['M4.4 7h15.2', 'M9.4 7V4.8h5.2V7', 'M7 7l1 13h8l1-13', 'M10 11v4.6', 'M14 11v4.6'],
  bolt: ['M13.2 2.6 5.2 13.4h5.4L10 21.4 18 10.6h-5.4z'],
  download: ['M12 3.6v11', 'M12 14.6l4-4', 'M12 14.6l-4-4', 'M4.6 20.4h14.8'],
  star: ['m12 3.6 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6L3.2 10l6.1-.9z'],
} as const;

export function MarketStats({ subscribers, downloads, stars }: { subscribers: number; downloads: number; stars: number }) {
  return (
    <div className="stats">
      <span className="stat" title="订阅数"><Glyph paths={glyphs.bolt} size={15} />{formatMarketCount(subscribers)}</span>
      <span className="stat" title="下载数"><Glyph paths={glyphs.download} size={15} />{formatMarketCount(downloads)}</span>
      <span className="stat" title="收藏次数"><Glyph paths={glyphs.star} size={15} />{formatMarketCount(stars)}</span>
    </div>
  );
}

type LocalCardProps = {
  readonly row: ConnectorSummary;
  /** 业务场景文案（分类字典 text，多值以「 · 」分隔）；自建实例为空串，界面保留空行以对齐。 */
  readonly category: string;
  /** 已加载的市场条目：用于还原市场安装实例的图标。 */
  readonly market: readonly MarketItem[];
  /** 授权索引里的对应条目：本地卡片的申请状态与申请入口都按它展示。 */
  readonly marketRef?: { readonly authorized: boolean; readonly applyStatus: ConnectorApplyStatus };
  /** 是否随客户端内置（与市场列表口径一致）：标签行展示「内置 / 非内置」。 */
  readonly builtin: boolean;
  readonly busy: boolean;
  /** 该实例正在启停：开关位置换成加载态，卡片底部显示流式进度条。 */
  readonly toggling: boolean;
  /** 单点跳转请求占用：申请/取消申请期间禁用按钮。 */
  readonly ssoBusy: boolean;
  readonly batchMode: boolean;
  readonly selected: boolean;
  readonly onOpen: (id: string) => void;
  readonly onToggle: (row: ConnectorSummary, enabled: boolean) => void;
  /** 危险操作按钮统一叫「卸载」：市场来源走市场卸载并上报，自建来源只在本机移除。 */
  readonly onUninstall: (row: ConnectorSummary) => void;
  readonly onSelect: (id: string) => void;
  readonly onApply: (row: ConnectorSummary) => void;
  readonly onCancelApply: (row: ConnectorSummary) => void;
  /** 「去试试」：新建会话、预选该 MCP 并预填一句提示词（与技能试用的交互一致）。 */
  readonly onTrial: (row: ConnectorSummary) => void;
};

/**
 * 卡片内自带行为的元素：开关、删除、安装加号、加载指示、批量勾选框等。
 * 命中它们时由元素自身处理，不冒泡触发整卡打开详情。
 */
function isCardAction(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button,a,input,select,textarea,.switch,.switch-loading,.batch-check,.plus'));
}

/**
 * 本地卡片：与市场卡片同一套版式。
 * 图标跨两行 · 名称 / service_id · 业务场景 · 描述（两行）· 标签 · 连接状态与工具数 · 操作按钮。
 */
export function LocalMcpCard({ row, category, market, marketRef, builtin, busy, toggling, ssoBusy, batchMode, selected, onOpen, onToggle, onUninstall, onSelect, onApply, onCancelApply, onTrial }: LocalCardProps) {
  // 授权异常时优先显示原因，开关一并置灰；记录里的用户启用位不变，恢复授权后可自动还原。
  const blocked = row.authState !== undefined;
  const state = blocked
    ? (row.authState === 'revoked' ? '已失效' : '未授权')
    : row.enabled ? connectorStateLabels[row.state] : '已停用';
  const actionText = row.enabled ? '停用' : '启用';
  const togglingText = `正在${actionText}…`;
  /**
   * 申请 / 取消申请只对「授权已失效」出现，与本地技能的判定一致：
   * 从未授权的市场资产说明本就不该装在本机，给申请入口反而引导用户重复申请；
   * 自建资产没有后台编号，根本没有可申请的资产，只展示原因文案。
   */
  const revoked = row.authState === 'revoked';
  const applyStatus = marketRef?.applyStatus;
  const cancelable = revoked && applyStatus === 'pending';
  const applicable = revoked && applyStatus !== 'pending';
  // 「去试试」只对当前真正可调用的实例有意义：已启用、已连接且未被授权/有效性阻断。
  const trialable = row.enabled && !blocked && row.state === 'ready';
  const version = row.installManifest?.version;
  /** 整卡可点击：点描述、状态行等空白区同样打开详情；批量模式下改为勾选。 */
  const openCard = (event: MouseEvent<HTMLElement>) => {
    if (isCardAction(event.target)) return;
    if (batchMode) onSelect(row.id);
    else onOpen(row.id);
  };
  return (
    <article className={`card local-card${row.enabled && !blocked ? '' : ' is-off'}${selected ? ' is-selected' : ''}`} onClick={openCard}>
      <div className="card-top">
        {batchMode ? (
          <button type="button" className="batch-check" role="checkbox" aria-checked={selected} aria-label={`选择 ${row.title}`} onClick={() => onSelect(row.id)}>{selected ? '✓' : ''}</button>
        ) : null}
        <button type="button" className="card-open" aria-label={`查看 ${row.title}`} onClick={() => (batchMode ? onSelect(row.id) : onOpen(row.id))}>
          <McpMark {...localMark(row, market)} />
          <span className="card-title">
            <strong title={row.title}>{row.title}</strong>
            <small className="market-slug" title={row.serverName}>{row.serverName}</small>
          </span>
        </button>
        {/* 启停要拉起或断开 MCP 进程，耗时可能十几秒：开关位置换成加载态，避免点了没反应。 */}
        {!batchMode && (toggling
          ? <span className="switch-loading" role="status" aria-label={`正在${actionText} ${row.title}`}><i className="spinner" /></span>
          : <button type="button" className="switch" role="switch" aria-checked={row.enabled && !blocked} aria-label={`${actionText} ${row.title}`} disabled={busy || blocked} onClick={() => onToggle(row, !row.enabled)} />)}
      </div>
      {/* 业务场景固定占一行：没有场景的条目保留空行，保证同一行卡片的后续内容上下对齐。 */}
      <small className={`tag market-scene${category ? '' : ' is-empty'}`} title={category || undefined} aria-hidden={category ? undefined : true}>
        {category || '\u00a0'}
      </small>
      <p className="card-desc">{row.description || 'MCP 服务'}</p>
      <div className="market-card-tags">
        {version ? <span className="version-tag">v{version.replace(/^v/iu, '')}</span> : null}
        {builtin ? <span className="builtin-pill">内置</span> : <span className="external-pill">非内置</span>}
        {blocked ? <span className="apply-pill none">未授权</span> : null}
        {blocked && applyStatus ? <span className={`apply-pill ${applyStatus}`}>{APPLY_LABEL[applyStatus]}</span> : null}
      </div>
      {/* 授权异常原因就地展示（闸门统一文案）：与技能的提示位一致，不自己拼文案。 */}
      {row.authState && row.authReason ? <p className="auth-reason">{row.authReason}</p> : null}
      <div className="card-foot">
        <span className="status-line"><i className={`dot${toggling ? ' discovering' : row.enabled && !blocked ? ` ${row.state}` : ''}`} />{toggling ? togglingText : state}</span>
        <span>{row.toolAuth ? `可用 ${row.toolAuth.usable}/${row.toolAuth.total} 个工具` : `${row.toolNames.length} 个工具`}</span>
      </div>
      {toggling ? (
        <div className="install-bar" role="progressbar" aria-label={`正在${actionText} ${row.title}`}>
          <i className="install-bar-fill" />
        </div>
      ) : null}
      {batchMode ? null : (
        <div className="market-card-actions">
          {trialable ? <button type="button" className="market-action primary" aria-label={`试用 ${row.title}`} onClick={() => onTrial(row)}>去试试</button> : null}
          {cancelable ? <button type="button" className="market-action primary" aria-label={`取消申请 ${row.title}`} disabled={ssoBusy} onClick={() => onCancelApply(row)}>取消申请</button> : null}
          {applicable ? <button type="button" className="market-action primary" aria-label={`申请 ${row.title}`} disabled={ssoBusy} onClick={() => onApply(row)}>申请</button> : null}
          <button type="button" className="market-action danger" aria-label={`卸载 ${row.title}`} disabled={busy || toggling} onClick={() => onUninstall(row)}>卸载</button>
        </div>
      )}
    </article>
  );
}

type MarketCardProps = {
  readonly entry: MarketItem;
  /** 该条目在界面上的分类文案（分类字典 text，多值以「 · 」分隔）；一个都映射不出时为空串，界面不显示占位。 */
  readonly category: string;
  readonly installed: boolean;
  /** 该条目正在安装：安装按钮进入加载态，卡片底部显示流式进度条。 */
  readonly installing: boolean;
  /** 上一次安装失败的原因（可直接展示）；失败时保留安装按钮，点一下就重试。 */
  readonly failure?: string;
  readonly busy: boolean;
  /** 单点跳转请求占用：申请/取消申请期间禁用按钮。 */
  readonly ssoBusy: boolean;
  readonly onOpen: (id: string) => void;
  readonly onInstall: (entry: MarketItem) => void;
  readonly onUninstall: (entry: MarketItem) => void;
  readonly onApply: (entry: MarketItem) => void;
  readonly onCancelApply: (entry: MarketItem) => void;
};

/**
 * 市场卡片：图标 · 名称 · 服务标识 · 分类 · 描述 · 统计行 · 状态徽标组 · 底部操作区。
 * 布局与技能市场一致：标签靠左、操作按钮靠右；卸载属于危险操作，固定放在最右侧。
 */
export function MarketMcpCard({ entry, category, installed, installing, failure, busy, ssoBusy, onOpen, onInstall, onUninstall, onApply, onCancelApply }: MarketCardProps) {
  /** 整卡可点击：点卡片任意空白区都打开详情，卡片内的按钮区仍走各自行为。 */
  const openCard = (event: MouseEvent<HTMLElement>) => {
    if (isCardAction(event.target)) return;
    onOpen(entry.originId);
  };
  const authorized = entry.authorized === true;
  // 未授权时：申请中给「取消申请」，其余状态都给「申请」（已通过但被撤权的仍可重新申请）。
  const cancelable = !authorized && entry.applyStatus === 'pending';
  const applicable = !authorized && entry.applyStatus !== 'pending';
  return (
    <article className={`card market-card${installing ? ' is-installing' : ''}`} onClick={openCard}>
      <div className="card-top">
        <button type="button" className="card-open" aria-label={`查看 ${entry.title}`} onClick={() => onOpen(entry.originId)}>
          <McpMark {...marketMark(entry)} />
          <span className="card-title">
            <strong title={entry.title}>{entry.title}</strong>
            <small className="market-slug" title={entry.serverName}>{entry.serverName}</small>
          </span>
        </button>
      </div>
      {/* 业务场景固定占一行：没有场景的条目保留空行，保证所有卡片的同名行上下对齐。 */}
      <small className={`tag market-scene${category ? '' : ' is-empty'}`} title={category || undefined} aria-hidden={category ? undefined : true}>
        {category || '\u00a0'}
      </small>
      <p className="card-desc">{entry.description}</p>
      {/* 统计信息改为蓝色标签：安装 / 下载 / 收藏，不再使用图标 + 数字。 */}
      <div className="market-stats-tags">
        <span className="stat-tag">安装 {entry.subscribers}</span>
        <span className="stat-tag">下载 {entry.downloads}</span>
        <span className="stat-tag">收藏 {entry.stars}</span>
      </div>
      <div className="market-card-foot">
        {/* 第一行：状态标签靠左；第二行：操作按钮靠右。 */}
        <div className="market-card-tags">
          {entry.version ? <span className="version-tag">{entry.version}</span> : null}
          {entry.builtin === undefined ? null : <span className={entry.builtin ? 'builtin-pill' : 'external-pill'}>{entry.builtin ? '内置' : '非内置'}</span>}
          <span className={installed ? 'installed-pill' : 'uninstalled-pill'}>{installed ? '已安装' : '未安装'}</span>
          <span className={`apply-pill ${authorized ? 'approved' : 'none'}`}>{authorized ? '已授权' : '未授权'}</span>
          <span className={`apply-pill ${entry.applyStatus}`}>{APPLY_LABEL[entry.applyStatus]}</span>
        </div>
        <div className="market-card-actions">
          {!installed && authorized
            ? installing
              ? <span className="plus installing" role="status" aria-label={`正在安装 ${entry.title}`}><i className="spinner" /></span>
              : <button type="button" className="market-action primary" aria-label={`${failure ? '重试安装' : '安装'} ${entry.title}`} title={failure ? '重新安装到本机' : '安装到本机'} disabled={busy} onClick={() => onInstall(entry)}>{failure ? '重试安装' : '安装'}</button>
            : null}
          {cancelable ? <button type="button" className="market-action primary" aria-label={`取消申请 ${entry.title}`} disabled={ssoBusy} onClick={() => onCancelApply(entry)}>取消申请</button> : null}
          {applicable ? <button type="button" className="market-action primary" aria-label={`申请 ${entry.title}`} disabled={ssoBusy} onClick={() => onApply(entry)}>申请</button> : null}
          {/* 随客户端内置的条目随安装包发布，市场侧不提供卸载入口。 */}
          {installed && entry.clientBuiltin !== true
            ? <button type="button" className="market-action danger" aria-label={`卸载 ${entry.title}`} disabled={busy} onClick={() => onUninstall(entry)}>卸载</button>
            : null}
        </div>
      </div>
      {installing ? (
        <div className="install-bar" role="progressbar" aria-label={`正在安装 ${entry.title}`}>
          <i className="install-bar-fill" />
        </div>
      ) : null}
      {failure && !installed ? <p className="card-error" role="alert">{failure}</p> : null}
    </article>
  );
}

