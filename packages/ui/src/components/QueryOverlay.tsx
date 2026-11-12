import * as React from 'react';

export type QueryOverlayProps = {
  /** 覆盖层文案；默认「查询中…」，各页保持同一口径。 */
  readonly label?: string;
};

/**
 * 查询中覆盖层：四点指示 + 文案 + 浅遮罩。
 *
 * 只负责覆盖层自身的结构与语义，定位交给调用方的内容容器（`position:relative`），
 * 因此技能、连接器、专家与模型市场共用同一份实现，避免各页复制样式。
 */
export function QueryOverlay({ label = '查询中…' }: QueryOverlayProps) {
  return (
    <div className="wd-query-overlay" role="status" aria-live="polite">
      <span className="wd-query-dots" aria-hidden="true"><i /><i /><i /><i /></span>
      <span>{label}</span>
    </div>
  );
}
