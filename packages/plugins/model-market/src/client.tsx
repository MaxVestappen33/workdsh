import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import { ModelSelectSeat } from './client/model-select/ModelSelectSeat.js';
import { ModelMarketPanel } from './client/ModelMarketPanel.js';
import {
  MODEL_MARKET_LABEL, MODEL_MARKET_SECTION, installSettingsSectionOpener,
} from './client/settings-nav.js';

export const name = 'workdsh-model-market-client';
export const inject = ['slots'];

/** 设置导航中本页的标签文本，用于在官方导航行里定位本插件注册的那一行。 */
const SECTION_LABEL = MODEL_MARKET_LABEL;
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

/** 官方设置外壳实例上我们需要的导航能力（`actions.openSection` 没有对外服务）。 */
interface SettingsShellActions {
  openSection?: (id: string) => void;
}

/**
 * 取设置外壳的已挂载实例。
 *
 * 外壳在 `sidebar.settings` 注册时把 shell store 一起交了出来，其 `create()`
 * 返回的就是当前挂载的那一个实例，因此这里可以拿到 `openSection` 精确切分区。
 */
function settingsShellActions(ctx: Context): SettingsShellActions | undefined {
  const entry = ctx.slots.entriesOfSlot('sidebar.settings' as never)[0];
  const handle = entry?.store as { create?: () => { actions?: SettingsShellActions } } | undefined;
  if (typeof handle?.create !== 'function') return undefined;
  try {
    return handle.create().actions;
  } catch {
    // 外壳尚未挂载时会抛错：当作不可用，交给调用方提示。
    return undefined;
  }
}

/**
 * 打开设置并切到模型管理分区。
 * @returns 是否成功跳转；外壳未就绪且设置未打开时返回 false。
 */
function openModelMarketSettings(ctx: Context): boolean {
  const actions = settingsShellActions(ctx);
  if (actions?.openSection !== undefined) {
    actions.openSection(MODEL_MARKET_SECTION);
    return true;
  }
  // 退路：外壳实例取不到但设置已经打开时，直接点本页的导航行。
  const cell = findNavCell(SECTION_LABEL);
  if (!cell) return false;
  cell.click();
  return true;
}

/** 会话输入框的模型座位；官方 single 槽，用更低优先级遮蔽即整块替换。 */
const MODEL_SEAT = 'conversation.input.model';

/**
 * 接管官方模型选择器。
 *
 * 等官方座位先注册（它带有现成的注入面：available / directory / load / select），
 * 再以 priority -10 注册自己的组件。这样既不用改官方文件，也不用重复实现
 * Session 绑定与目录加载；插件卸载时我们的注册被销毁，官方座位原样回归。
 */
function installModelSeat(ctx: Context): void {
  let dispose: (() => void) | undefined;
  const take = (): void => {
    if (dispose) return;
    const original = ctx.slots.entriesOfSlot(MODEL_SEAT as never).find(entry => typeof entry.inject === 'function');
    if (!original?.inject) return;
    dispose = ctx.slots.register(
      { name: MODEL_SEAT, priority: -10, inject: original.inject } as never,
      ModelSelectSeat as never,
    );
  };
  ctx.effect(() => {
    const stop = ctx.slots.subscribe(MODEL_SEAT as never, take);
    take();
    return () => {
      stop();
      dispose?.();
      dispose = undefined;
    };
  }, 'workdsh.model-market.model-seat');
}

/** Client 入口：在设置导航中紧跟「模型」注册模型管理页，并取代官方模型页。 */
export function apply(ctx: Context): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: MODEL_MARKET_SECTION,
    label: SECTION_LABEL,
    order: 11,
  }, ModelMarketPanel));
  // 会话选择器点「配置本地模型」时，经这里打开设置并落到本页。
  ctx.effect(() => {
    installSettingsSectionOpener(id => (id === MODEL_MARKET_SECTION ? openModelMarketSettings(ctx) : false));
    return () => installSettingsSectionOpener(undefined);
  }, 'workdsh.model-market.settings-nav');
  installModelSeat(ctx);
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
