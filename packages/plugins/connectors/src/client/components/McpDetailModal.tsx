import { Button, Modal } from 'workdsh-ui';
import type { MarketItem } from '../../market.js';
import type { ConnectorSummary } from '../../shared.js';
import { connectorStateLabels, formatMarketCount, localMark, marketMark, McpMark } from './McpCard.js';
import { ToolList } from './ToolList.js';

type LocalDetailProps = {
  readonly row: ConnectorSummary | undefined;
  /** 该实例在「我的本地 MCP」里归入的分类。 */
  readonly category: string;
  /** 已加载的市场条目：用于还原市场安装实例的图标。 */
  readonly market: readonly MarketItem[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onEdit: (row: ConnectorSummary) => void;
  readonly onToggle: (row: ConnectorSummary, enabled: boolean) => void;
  readonly onRemove: (row: ConnectorSummary) => void;
  readonly onUninstall: (row: ConnectorSummary) => void;
};

/** 本地实例详情：真实状态、来源、分类、工具数、资源与 URI 模板，以及启停/编辑/删除/卸载入口。 */
export function LocalMcpDetailModal({ row, category, market, busy, onClose, onEdit, onToggle, onRemove, onUninstall }: LocalDetailProps) {
  const state = row ? (row.enabled ? connectorStateLabels[row.state] : '已停用') : '';
  return (
    <Modal open={Boolean(row)} label="MCP 详情" className="connector-detail-dialog" onClose={onClose}>
      {row ? (
        <>
          <div className="detail-hero">
            <McpMark {...localMark(row, market)} large />
            <div className="detail-title">
              <h1>{row.title}</h1>
              <span className="status-line"><i className={`dot${row.enabled ? ` ${row.state}` : ''}`} />{state} · {row.transport} · {row.serverName}</span>
            </div>
            <div className="detail-actions">
              <Button disabled={busy} onClick={() => onEdit(row)}>编辑</Button>
              <button type="button" className="switch" role="switch" aria-checked={row.enabled} aria-label={`${row.enabled ? '停用' : '启用'} ${row.title}`} disabled={busy} onClick={() => onToggle(row, !row.enabled)} />
            </div>
          </div>
          <p className="detail-summary">{row.description || 'MCP 服务'}</p>
          <div className="metrics">
            <div className="metric"><small>真实状态</small><strong>{state}</strong></div>
            <div className="metric"><small>来源</small><strong>{row.originId ? '市场安装' : '本机自建'}</strong></div>
            <div className="metric"><small>分类</small><strong>{category}</strong></div>
            <div className="metric"><small>MCP 工具</small><strong>{row.toolNames.length}</strong></div>
            <div className="metric"><small>资源 / URI 模板</small><strong>{row.resourceCount} / {row.resourceTemplateCount}</strong></div>
            <ToolList title="会话可调用工具" tools={row.toolNames.map(name => ({ name }))} empty="停用后工具已从官方目录移除" />
          </div>
          {row.diagnostic ? <p className="error" role="alert">{row.diagnostic}</p> : null}
          <div className="detail-footer">
            <Button tone="danger" className="danger" disabled={busy} onClick={() => onRemove(row)}>删除此 MCP</Button>
            {row.originId ? <><span className="spacer" /><Button disabled={busy} onClick={() => onUninstall(row)}>卸载</Button></> : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}

type MarketDetailProps = {
  readonly entry: MarketItem | undefined;
  /** 该条目在界面上的分类文案（分类字典 text，多值以「 · 」分隔）；一个都映射不出时为空串。 */
  readonly category: string;
  readonly installed: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onInstall: (entry: MarketItem) => void;
};

/** 工具入参展示：沿用详情弹窗既有的「参数：a（必填）、b」文案。 */
const paramsText = (tool: MarketItem['tools'][number]): string | undefined => {
  const rows = tool.parameters.map(parameter => (parameter.required ? `${parameter.name}（必填）` : parameter.name));
  return rows.length ? rows.join('、') : undefined;
};

/** 市场条目详情：订阅数 / 下载数 / 收藏次数 / 工具数，以及订阅后的工具清单。 */
export function MarketMcpDetailModal({ entry, category, installed, busy, onClose, onInstall }: MarketDetailProps) {
  return (
    <Modal open={Boolean(entry)} label="MCP 市场详情" className="connector-detail-dialog" onClose={onClose}>
      {entry ? (
        <>
          <div className="detail-hero">
            <McpMark {...marketMark(entry)} large />
            <div className="detail-title">
              <h1>{entry.title}</h1>
              {/* 分类一个都映射不出时只显示连接方式，不留空占位。 */}
              <span className="status-line">{[category, entry.transport].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="detail-actions">
              {installed
                ? <Button disabled>已安装</Button>
                : <Button variant="primary" className="primary" disabled={busy} onClick={() => onInstall(entry)}>订阅并连接</Button>}
            </div>
          </div>
          <p className="detail-summary">{entry.description}</p>
          <div className="metrics">
            <div className="metric"><small>订阅数</small><strong>{formatMarketCount(entry.subscribers)}</strong></div>
            <div className="metric"><small>下载数</small><strong>{formatMarketCount(entry.downloads)}</strong></div>
            <div className="metric"><small>收藏次数</small><strong>{formatMarketCount(entry.stars)}</strong></div>
            <div className="metric"><small>MCP 工具</small><strong>{entry.tools.length}</strong></div>
            <ToolList title="订阅后提供的工具" tools={entry.tools.map(tool => ({ name: tool.name, description: tool.description, params: paramsText(tool) }))} empty="市场条目暂未提供工具清单" />
          </div>
        </>
      ) : null}
    </Modal>
  );
}
