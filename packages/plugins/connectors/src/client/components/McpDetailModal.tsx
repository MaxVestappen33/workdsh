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
  /** 该实例正在启停：开关转为加载态，说明区显示流式进度条。 */
  readonly toggling: boolean;
  readonly onClose: () => void;
  readonly onToggle: (row: ConnectorSummary, enabled: boolean) => void;
  readonly onRemove: (row: ConnectorSummary) => void;
  readonly onUninstall: (row: ConnectorSummary) => void;
};

/** 本地实例详情：真实状态、来源、分类、工具数、资源与 URI 模板，以及启停与移除入口。 */
export function LocalMcpDetailModal({ row, category, market, busy, toggling, onClose, onToggle, onRemove, onUninstall }: LocalDetailProps) {
  const state = row ? (row.enabled ? connectorStateLabels[row.state] : '已停用') : '';
  const actionText = row?.enabled ? '停用' : '启用';
  const togglingText = `正在${actionText}…`;
  /** 已连接的实例只剩「资源未统计」这类说明，不是故障；只有真连不上时才用错误样式。 */
  const failed = Boolean(row && (row.state === 'offline' || row.state === 'discovering'));
  return (
    <Modal open={Boolean(row)} label="MCP 详情" className="connector-detail-dialog" onClose={onClose}>
      {row ? (
        <>
          <div className="detail-hero">
            <McpMark {...localMark(row, market)} large />
            <div className="detail-title">
              <h1>{row.title}</h1>
              <span className="status-line"><i className={`dot${toggling ? ' discovering' : row.enabled ? ` ${row.state}` : ''}`} />{toggling ? togglingText : state} · {row.transport} · {row.serverName}</span>
            </div>
            <div className="detail-actions">
              {/* 按钮统一叫「卸载」：市场安装的实例先向后台上报再移除本机，内置实例只做本机移除。 */}
              <Button tone="danger" className="danger" disabled={busy || toggling} onClick={() => (row.originId ? onUninstall(row) : onRemove(row))}>卸载</Button>
              <button type="button" className="switch" role="switch" aria-checked={row.enabled} aria-label={`${actionText} ${row.title}`} disabled={busy || toggling} onClick={() => onToggle(row, !row.enabled)} />
            </div>
          </div>
          <p className="detail-summary">{row.description || 'MCP 服务'}</p>
          {toggling ? (
            <div className="install-bar" role="progressbar" aria-label={`正在${actionText} ${row.title}`}>
              <i className="install-bar-fill" />
            </div>
          ) : null}
          <div className="metrics">
            <div className="metric-grid">
              <div className="metric"><small>真实状态</small><strong>{state}</strong></div>
              <div className="metric"><small>来源</small><strong>{row.originId ? '市场安装' : '内置'}</strong></div>
              <div className="metric"><small>分类</small><strong>{category || '—'}</strong></div>
              <div className="metric"><small>MCP 工具</small><strong>{row.toolNames.length}</strong></div>
              <div className="metric"><small>资源 / URI 模板</small><strong>{row.resourceCount} / {row.resourceTemplateCount}</strong></div>
            </div>
            <ToolList title="会话可调用工具" tools={row.toolNames.map(name => ({ name }))} empty="停用后工具已从官方目录移除" />
          </div>
          {row.diagnostic ? (failed ? <p className="error" role="alert">{row.diagnostic}</p> : <p className="hint">{row.diagnostic}</p>) : null}
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
  /** 该条目正在安装：按钮进入加载态并禁止重复点击。 */
  readonly installing: boolean;
  /** 上一次安装失败的原因（可直接展示）：按钮改为「重试安装」，原因就地显示。 */
  readonly failure?: string;
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
export function MarketMcpDetailModal({ entry, category, installed, installing, failure, busy, onClose, onInstall }: MarketDetailProps) {
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
              {/* 未安装＝可点击的「安装」，已安装＝绿色只读「已安装」，一眼能区分状态。 */}
              {installed
                ? <Button className="installed-action" disabled>已安装</Button>
                : <Button variant="primary" className="primary" disabled={busy || installing} onClick={() => onInstall(entry)}>{installing ? '正在安装…' : failure ? '重试安装' : '安装'}</Button>}
            </div>
          </div>
          <p className="detail-summary">{entry.description}</p>
          {installing ? (
            <div className="install-bar" role="progressbar" aria-label={`正在安装 ${entry.title}`}>
              <i className="install-bar-fill" />
            </div>
          ) : null}
          {/* 安装失败的原因（仓库不可达、包不存在、超时等）就地展示，不需要用户回列表里找。 */}
          {failure && !installed && !installing ? <p className="error" role="alert">{failure}</p> : null}
          <div className="metrics">
            <div className="metric-grid">
              <div className="metric"><small>订阅数</small><strong>{formatMarketCount(entry.subscribers)}</strong></div>
              <div className="metric"><small>下载数</small><strong>{formatMarketCount(entry.downloads)}</strong></div>
              <div className="metric"><small>收藏次数</small><strong>{formatMarketCount(entry.stars)}</strong></div>
              <div className="metric"><small>MCP 工具</small><strong>{entry.tools.length}</strong></div>
            </div>
            <ToolList title="订阅后提供的工具" tools={entry.tools.map(tool => ({ name: tool.name, description: tool.description, params: paramsText(tool) }))} empty="市场条目暂未提供工具清单" />
          </div>
        </>
      ) : null}
    </Modal>
  );
}
