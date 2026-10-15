import { useState } from 'react';
import { Icon } from 'workdsh-ui';
import type { MarketItem } from '../../market.js';
import type { ConnectorSummary } from '../../shared.js';

export const connectorStateLabels = {
  ready: '已连接',
  discovering: '正在连接',
  offline: '连接异常',
  disabled: '已停用',
} as const;

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
  readonly category: string;
  /** 已加载的市场条目：用于还原市场安装实例的图标。 */
  readonly market: readonly MarketItem[];
  readonly busy: boolean;
  readonly batchMode: boolean;
  readonly selected: boolean;
  readonly onOpen: (id: string) => void;
  readonly onToggle: (row: ConnectorSummary, enabled: boolean) => void;
  readonly onRemove: (row: ConnectorSummary) => void;
  readonly onSelect: (id: string) => void;
};

/** 本地卡片：图标 · 名称 · 来源与分类 · 描述 · 状态 · 工具数 · 启停开关 · 删除（批量模式下改为勾选）。 */
export function LocalMcpCard({ row, category, market, busy, batchMode, selected, onOpen, onToggle, onRemove, onSelect }: LocalCardProps) {
  const tag = `${row.originId ? '已安装' : '自建'} · ${category}`;
  const state = row.enabled ? connectorStateLabels[row.state] : '已停用';
  return (
    <article className={`card${row.enabled ? '' : ' is-off'}${selected ? ' is-selected' : ''}`}>
      <div className="card-top">
        {batchMode ? (
          <button type="button" className="batch-check" role="checkbox" aria-checked={selected} aria-label={`选择 ${row.title}`} onClick={() => onSelect(row.id)}>{selected ? '✓' : ''}</button>
        ) : null}
        <button type="button" className="card-open" aria-label={`查看 ${row.title}`} onClick={() => (batchMode ? onSelect(row.id) : onOpen(row.id))}>
          <McpMark {...localMark(row, market)} />
          <span className="card-title">
            <strong title={row.title}>{row.title}</strong>
            <small className="tag" title={tag}>{tag}</small>
          </span>
        </button>
        {batchMode ? null : (
          <>
            <button type="button" className="switch" role="switch" aria-checked={row.enabled} aria-label={`${row.enabled ? '停用' : '启用'} ${row.title}`} disabled={busy} onClick={() => onToggle(row, !row.enabled)} />
            <button type="button" className="card-delete" title="删除 MCP" aria-label={`删除 ${row.title}`} disabled={busy} onClick={() => onRemove(row)}><Glyph paths={glyphs.trash} /></button>
          </>
        )}
      </div>
      <p className="card-desc">{row.description || 'MCP 服务'}</p>
      <div className="card-foot">
        <span className="status-line"><i className={`dot${row.enabled ? ` ${row.state}` : ''}`} />{state}</span>
        <span>{row.toolNames.length} 个工具</span>
      </div>
    </article>
  );
}

type MarketCardProps = {
  readonly entry: MarketItem;
  /** 该条目在界面上的分类文案（分类字典 text，多值以「 · 」分隔）；一个都映射不出时为空串，界面不显示占位。 */
  readonly category: string;
  readonly installed: boolean;
  readonly busy: boolean;
  readonly onOpen: (id: string) => void;
  readonly onInstall: (entry: MarketItem) => void;
};

/** 市场卡片：图标 · 名称 · 分类 · 描述 · 统计行 · 右上角「＋」（已安装时替换为禁用态胶囊）。 */
export function MarketMcpCard({ entry, category, installed, busy, onOpen, onInstall }: MarketCardProps) {
  return (
    <article className="card">
      <div className="card-top">
        <button type="button" className="card-open" aria-label={`查看 ${entry.title}`} onClick={() => onOpen(entry.originId)}>
          <McpMark {...marketMark(entry)} />
          <span className="card-title">
            <strong title={entry.title}>{entry.title}</strong>
            {category ? <small title={category}>{category}</small> : null}
          </span>
        </button>
        {installed ? (
          <span className="installed-pill">已安装</span>
        ) : (
          <button type="button" className="plus" title="安装到本机" aria-label={`安装 ${entry.title}`} disabled={busy} onClick={() => onInstall(entry)}><Icon name="plus" size={18} /></button>
        )}
      </div>
      <p className="card-desc">{entry.description}</p>
      <MarketStats subscribers={entry.subscribers} downloads={entry.downloads} stars={entry.stars} />
    </article>
  );
}
