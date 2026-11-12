import type { CSSProperties } from 'react';

/** 容器尺寸由配置决定，不继承官方 `.brandMark` / `.fishHitbox` 的布局假设。 */
export function markBoxStyle(size: number): CSSProperties {
  return { display: 'inline-block', width: size, height: size, flex: 'none', verticalAlign: 'middle' };
}

/** 折叠态徽标：官方把它放在侧栏切换按钮内，只能用极小的胶囊尺寸。 */
export const toggleBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 14,
  padding: '0 5px',
  border: '0.5px solid var(--dsw-alias-interactive-bg-hover)',
  borderRadius: 999,
  background: 'var(--dsw-alias-state-business-tertiary)',
  color: 'var(--dsw-alias-label-primary-bluish)',
  fontFamily: 'var(--ds-font-family-code)',
  fontSize: 9,
  fontWeight: 500,
  lineHeight: '14px',
  whiteSpace: 'nowrap',
};
