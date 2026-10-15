import { Button } from 'workdsh-ui';

type BatchBarProps = {
  readonly count: number;
  readonly busy: boolean;
  readonly onDelete: () => void;
  readonly onExit: () => void;
};

/** 批量删除操作条：仅「我的本地 MCP」Tab 显示。 */
export function BatchBar({ count, busy, onDelete, onExit }: BatchBarProps) {
  return (
    <div className="batch-bar" role="toolbar" aria-label="批量管理本地 MCP">
      <span>已选择 {count} 项</span>
      <Button tone="danger" className="danger" disabled={!count || busy} onClick={onDelete}>删除所选</Button>
      <Button disabled={busy} onClick={onExit}>退出批量</Button>
    </div>
  );
}
