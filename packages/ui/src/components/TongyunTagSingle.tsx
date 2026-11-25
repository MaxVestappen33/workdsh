import * as React from 'react';
import { normalizeHex, paletteFromHex } from './tag-color.js';

/** 状态标签色系：灰 / 青 / 绿 / 蓝 / 红。 */
export type TongyunTagTone = 'gray' | 'cyan' | 'green' | 'blue' | 'red';

/** 申请状态取值（与技能、连接器、专家的后台状态一致）。 */
export type TongyunApplyStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface TongyunTagSingleProps {
  /** 标签文案。 */
  children: React.ReactNode;
  /** 色系，默认 `gray`。 */
  tone?: TongyunTagTone;
  /**
   * 授权语义：`true` 已授权（绿）、`false` 未授权（中性灰）。
   * 优先级低于 `color`，高于 `tone`。
   */
  auth?: boolean;
  /**
   * 自定义主色（hex，`#rgb` / `#rrggbb`，`#` 可省略）。
   * 由主色推导浅底 / 同色描边 / 深色文字，优先级最高；非法颜色视为未传，
   * 回退到 `auth` → `tone` → `gray`。
   */
  color?: string;
  className?: string;
  /** 悬停提示（可选）。 */
  title?: string;
}

/** 申请状态到色系的固定映射：未申请灰、申请中蓝、已通过绿、未通过红。 */
export function applyStatusTone(status: TongyunApplyStatus | undefined): TongyunTagTone {
  if (status === 'pending') return 'blue';
  if (status === 'approved') return 'green';
  if (status === 'rejected') return 'red';
  return 'gray';
}

/** 版本号标签文案：统一补 `v` 前缀并去掉已有的重复前缀（`1.0` / `v1.0` → `v1.0`）。 */
export function formatTagVersion(version: string): string {
  const text = version.trim().replace(/^v/iu, '');
  return `v${text}`;
}

/**
 * 同云状态标签：20px 高、4px 圆角、1px 描边、12px 字号，
 * 覆盖版本号 / 内置 / 安装 / 授权 / 申请状态等卡片状态位。
 *
 * 颜色优先级：`color`（自定义主色）> `auth`（授权语义）> `tone`（色系）。
 */
export function TongyunTagSingle({ children, tone = 'gray', auth, color, className, title }: TongyunTagSingleProps) {
  const customHex = normalizeHex(color);
  const palette = customHex ? paletteFromHex(customHex) : undefined;
  const resolved: TongyunTagTone = auth === undefined ? tone : auth ? 'green' : 'gray';
  const classes = `wd-tag-single ${palette ? 'wd-tag-single--custom' : `wd-tag-single--${resolved}`}${className ? ` ${className}` : ''}`;
  const style = palette
    ? ({
        '--wd-tag-single-bg': palette.bg,
        '--wd-tag-single-border': palette.border,
        '--wd-tag-single-text': palette.text,
      } as React.CSSProperties)
    : undefined;
  return <span className={classes} style={style} title={title}>{children}</span>;
}
