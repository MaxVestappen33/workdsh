import * as React from 'react';

/** 占位卡形态：与目标页面真实卡片保持一致，加载完成后列表高度不会大幅跳变。 */
export type CardSkeletonVariant = 'compact' | 'tile' | 'avatar' | 'model';

export type CardSkeletonProps = {
  /** 占位卡数量：按首屏可见卡片量取值。 */
  readonly count?: number;
  /**
   * 占位卡形态：
   * - `compact`：技能页卡片（图标 + 名称/标识两行 + 右侧操作位，与市场卡同高）；
   * - `tile`：带方形图标、两行说明、标签与底部状态位的卡片（连接器，4 列）；
   * - `avatar`：带头像圆、两行说明与标签/底部徽标的卡片（专家，4 列）；
   * - `model`：带小图标、元信息与底部操作位的卡片（模型市场，2 列）。
   */
  readonly variant?: CardSkeletonVariant;
};

/**
 * 卡片网格的加载占位。
 *
 * 只渲染卡片本体，由调用方放进自己的网格容器（例如 `.grid`），
 * 因此各业务面板可以直接复用同一份结构与样式，不需要复制 CSS。
 */
export function CardSkeleton({ count = 12, variant = 'compact' }: CardSkeletonProps) {
  if (variant === 'compact') {
    return <>
      {Array.from({ length: count }, (_, index) => (
        <article className="wd-card-skeleton" aria-hidden="true" key={index}>
          <span className="wd-card-skeleton-mark" />
          <span className="wd-card-skeleton-body">
            <span className="wd-card-skeleton-line title" />
            <span className="wd-card-skeleton-line sub" />
          </span>
          <span className="wd-card-skeleton-action" />
        </article>
      ))}
    </>;
  }
  return <>
    {Array.from({ length: count }, (_, index) => (
      <article className={`wd-card-skeleton v-${variant}`} aria-hidden="true" key={index}>
        <div className="wd-card-skeleton-top">
          <span className="wd-card-skeleton-mark" />
          <span className="wd-card-skeleton-lines">
            <span className="wd-card-skeleton-line title" />
            <span className="wd-card-skeleton-line sub" />
          </span>
        </div>
        <span className="wd-card-skeleton-line desc" />
        <span className="wd-card-skeleton-line desc short" />
        <div className="wd-card-skeleton-tags"><span /><span /></div>
        <div className="wd-card-skeleton-foot"><span /><span /></div>
      </article>
    ))}
  </>;
}
