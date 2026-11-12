import * as React from 'react';
import { LogoMark } from 'workdsh-ui';
import { BRAND } from '../generated/brand.js';
import { markBoxStyle, toggleBadgeStyle } from './styles.js';

/** 侧栏与 hero 同时挂载时渐变 id 不能重复，各自用独立前缀。 */
const SIDEBAR_ID_PREFIX = 'workdsh-mark';
const HERO_ID_PREFIX = 'workdsh-hero-mark';

type MarkProps = {
  readonly svg: string | null;
  readonly size: number;
  readonly idPrefix: string;
  readonly className?: string;
};

/** 配置了 assets/ 里的 SVG 就用图片渲染；否则复用 workdsh-ui 的 LogoMark。 */
function BrandMark({ svg, size, idPrefix, className }: MarkProps) {
  if (svg !== null) {
    return (
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
        width={size}
        height={size}
        className={className}
        style={markBoxStyle(size)}
        alt=""
        draggable={false}
      />
    );
  }
  return <LogoMark size={size} className={className} idPrefix={idPrefix} />;
}

/** 侧栏展开态与折叠态共用同一个槽，一次注册覆盖两态。 */
export function SidebarBrandMark() {
  return (
    <BrandMark svg={BRAND.sidebar.mark.svg} size={BRAND.sidebar.mark.size} idPrefix={SIDEBAR_ID_PREFIX} />
  );
}

export function SidebarBrandName() {
  return <span data-testid="workdsh-brand">{BRAND.sidebar.name}</span>;
}

/** 官方该槽没有 fallback，默认配置下不渲染任何内容。 */
export function SidebarToggleBadge() {
  const { visible, text } = BRAND.sidebar.badge;
  if (!visible || text.length === 0) return null;
  return (
    <span style={toggleBadgeStyle} aria-hidden="true">
      {text}
    </span>
  );
}

/** 官方把 `.fishHitbox` 的 hover 类名透传进来，这里原样交给 `<svg>`。 */
export function HeroBrandMark({ className }: { readonly size?: number; readonly className?: string }) {
  return (
    <BrandMark
      svg={BRAND.hero.mark.svg}
      size={BRAND.hero.mark.size}
      idPrefix={HERO_ID_PREFIX}
      className={className}
    />
  );
}
