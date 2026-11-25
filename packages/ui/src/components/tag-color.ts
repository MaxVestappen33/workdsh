/** 状态标签/标签行的主色推导：hex → HSL → 浅底 / 同色描边 / 深色文字。 */

/** 规范化 hex 颜色（支持 #abc 简写），非法返回 null。 */
export function normalizeHex(value: string | undefined): string | null {
  let hex = String(value ?? '').trim();
  if (!hex) return null;
  if (hex.charAt(0) !== '#') hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : null;
}

/** hex 转 HSL（h 0-360，s/l 0-100）。 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }
  return { h: Math.round(hue), s: Math.round(saturation * 100), l: Math.round(lightness * 100) };
}

/** 由单一主色推导一套浅底标签配色。 */
export function paletteFromHex(hex: string): { bg: string; border: string; text: string } {
  const hsl = hexToHsl(hex);
  return {
    bg: `hsl(${hsl.h} ${Math.round(hsl.s * 0.8)}% 96.5%)`,
    border: `hsl(${hsl.h} ${Math.round(hsl.s * 0.85)}% 85%)`,
    text: `hsl(${hsl.h} ${Math.round(hsl.s * 0.9)}% 32%)`,
  };
}
