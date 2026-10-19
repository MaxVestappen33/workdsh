import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { ModelMarketPanel } from './client/ModelMarketPanel.js';

export const name = 'workdsh-model-market-client';
export const inject = ['slots'];

/** 设置导航中本页的标签文本，用于在官方导航行里定位本插件注册的那一行。 */
const SECTION_LABEL = '模型管理';
/** 官方模型页的导航文案；本页取代该页，仅用于确认紧邻的前一行确实是它。 */
const OFFICIAL_MODELS_LABELS = new Set(['模型', 'Models']);

/**
 * 在设置导航中定位指定标签的行。
 * 只匹配按钮直属的标签 span，避免误命中页面正文里的同名文本。
 */
function findNavCell(label: string): HTMLElement | undefined {
  for (const span of document.querySelectorAll<HTMLElement>('button > span')) {
    if (span.textContent?.trim() === label) return span.parentElement ?? undefined;
  }
  return undefined;
}

/** 把源图标的属性与子节点整体复制到目标 svg，保留 React 持有的目标节点引用。 */
function mirrorIcon(target: SVGSVGElement, source: SVGSVGElement): void {
  for (const { name, value } of [...source.attributes]) target.setAttribute(name, value);
  target.replaceChildren(...[...source.childNodes].map(node => node.cloneNode(true)));
}

/** 缓存已定位的本页导航行，设置面板关闭后失效重找。 */
let sectionCell: HTMLElement | undefined;
/** 被本页取代、仅做视觉隐藏的官方模型行；卸载时恢复其原状。 */
let replacedCell: HTMLElement | undefined;

/**
 * 让「模型管理」取代官方「模型」页。
 * 官方设置外壳按 section id 写死图标与页面，且没有图标或隐藏注册位；
 * 官方模型页 order 10、本页 order 11，因此直接处理紧邻的前一行：
 * 隐藏其导航入口（保留在 DOM 中作为图标来源），并把同一枚图标镜像到本页，
 * 既与官方「模型」完全一致，也能随官方版本升级自动跟随。
 */
function syncNav(): void {
  if (!sectionCell?.isConnected) {
    // 设置面板未打开时不做全量扫描，只留一次廉价的对话框探测。
    if (!document.querySelector('[role="dialog"]')) return;
    sectionCell = findNavCell(SECTION_LABEL);
  }
  const cell = sectionCell;
  const official = cell?.previousElementSibling;
  if (!cell || !(official instanceof HTMLElement)) return;
  // 前一行不是官方模型页时保持原样，避免误隐藏其他设置分区。
  if (!OFFICIAL_MODELS_LABELS.has(official.querySelector('span')?.textContent?.trim() ?? '')) return;

  if (replacedCell !== official) {
    replacedCell = official;
    official.style.display = 'none';
    official.setAttribute('aria-hidden', 'true');
    official.tabIndex = -1;
  }
  // 打开设置时若仍停在被隐藏的官方页，切回本页。
  if (official.getAttribute('aria-current') === 'true') cell.click();

  const source = official.querySelector('svg');
  const target = cell.querySelector('svg');
  if (source && target && target.outerHTML !== source.outerHTML) mirrorIcon(target, source);
}

/** 插件卸载时恢复被隐藏的官方导航行。 */
function restoreReplacedCell(): void {
  if (!replacedCell) return;
  replacedCell.style.display = '';
  replacedCell.removeAttribute('aria-hidden');
  replacedCell.removeAttribute('tabindex');
  replacedCell = undefined;
}

/** Client 入口：在设置导航中紧跟「模型」注册模型管理页，并取代官方模型页。 */
export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'workdsh-model-market',
    label: SECTION_LABEL,
    order: 11,
  }, ModelMarketPanel));
  // 设置面板按需挂载，用 MutationObserver + rAF 合并同一帧内的多次变更后同步。
  ctx.effect(() => {
    let frame = 0;
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        syncNav();
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    syncNav();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      restoreReplacedCell();
    };
  }, 'workdsh.model-market.nav');
}
