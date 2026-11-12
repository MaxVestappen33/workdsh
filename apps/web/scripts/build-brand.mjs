import { build } from 'esbuild';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Deployment-level brand configuration: one JSON file compiled into the artifacts. */
const PACKAGE_ROOT = new URL('../../../packages/plugins/brand/', import.meta.url);
/** 产物真实版本：electron-builder 用它给安装包命名，界面展示必须同源。 */
const DESKTOP_MANIFEST = new URL('../../../apps/desktop/package.json', import.meta.url);
const CONFIG_FILE = 'brand.config.json';
const GENERATED_FILE = 'src/generated/brand.ts';
const MAX_ASSET_BYTES = 256 * 1024;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.svg$/;
const SVG_ROOT = /^(?:\uFEFF)?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;

const fail = (path, message) => {
  throw new Error(`brand.config.json ${path} ${message}`);
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function objectAt(value, path, keys) {
  if (!isPlainObject(value)) fail(path, '必须是对象');
  const unknown = Object.keys(value).filter(key => !keys.includes(key));
  if (unknown.length > 0) fail(path, `出现未知字段 ${unknown.join(', ')}`);
  for (const key of keys) if (!(key in value)) fail(path, `缺少字段 ${key}`);
  return value;
}

function booleanAt(value, path) {
  if (typeof value !== 'boolean') fail(path, '必须是布尔值');
  return value;
}

function textAt(value, path, { max }) {
  if (typeof value !== 'string') fail(path, '必须是字符串');
  const text = value.trim();
  if (text.length === 0) fail(path, '不能为空');
  if (text.length > max) fail(path, `长度不能超过 ${String(max)}`);
  return text;
}

function sizeAt(value, path) {
  if (!Number.isInteger(value)) fail(path, '必须是整数');
  if (value < 4 || value > 128) fail(path, '必须在 4 到 128 之间');
  return value;
}

function assetNameAt(value, path) {
  if (value === null) return null;
  if (typeof value !== 'string') fail(path, '必须是字符串或 null');
  if (!ASSET_NAME.test(value)) fail(path, '必须是 assets/ 下的 .svg 文件名（不含路径）');
  return value;
}

function markAt(value, path) {
  const mark = objectAt(value, path, ['size', 'asset']);
  return { size: sizeAt(mark.size, `${path}.size`), asset: assetNameAt(mark.asset, `${path}.asset`) };
}

const BADGE_MODES = ['version', 'text', 'hidden'];

/** 版本号文案：版本号本身已带 v/V 前缀时不重复添加。 */
export function formatVersionBadge(version) {
  return /^[vV]/u.test(version) ? version : `v${version}`;
}

/** 从产物清单读取真实版本号，保证界面版本与安装包版本同源。 */
export async function readDesktopVersion(manifest = DESKTOP_MANIFEST) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifest, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取产物版本清单：${error.message}`);
  }
  if (!isPlainObject(parsed) || typeof parsed.version !== 'string' || parsed.version.trim().length === 0) {
    throw new Error('apps/desktop/package.json 缺少有效 version');
  }
  return parsed.version.trim();
}

function heroBadgeAt(value) {
  const path = 'hero.badge';
  if (!isPlainObject(value)) fail(path, '必须是对象');
  const unknown = Object.keys(value).filter(key => !['mode', 'text'].includes(key));
  if (unknown.length > 0) fail(path, `出现未知字段 ${unknown.join(', ')}`);
  if (!BADGE_MODES.includes(value.mode)) fail(`${path}.mode`, `必须是 ${BADGE_MODES.join(' / ')}`);
  if (value.mode === 'text') {
    if (value.text === undefined) fail(`${path}.text`, 'mode=text 时必须提供');
    return { mode: 'text', text: textAt(value.text, `${path}.text`, { max: 16 }) };
  }
  if (value.text !== undefined) fail(`${path}.text`, '只有在 mode=text 时才允许设置');
  return { mode: value.mode, text: null };
}

function readConfig(raw) {
  const root = objectAt(raw, '根', ['sidebar', 'hero']);

  const sidebar = objectAt(root.sidebar, 'sidebar', ['mark', 'name', 'badge']);
  const badge = objectAt(sidebar.badge, 'sidebar.badge', ['visible', 'text']);
  if (typeof badge.text !== 'string') fail('sidebar.badge.text', '必须是字符串');
  if (badge.text.length > 16) fail('sidebar.badge.text', '长度不能超过 16');
  const sidebarBadge = {
    visible: booleanAt(badge.visible, 'sidebar.badge.visible'),
    text: badge.text.trim(),
  };
  if (sidebarBadge.visible && sidebarBadge.text.length === 0) fail('sidebar.badge.text', '可见时不能为空');

  const hero = objectAt(root.hero, 'hero', ['title', 'badge', 'mark']);

  return {
    sidebar: {
      mark: markAt(sidebar.mark, 'sidebar.mark'),
      name: textAt(sidebar.name, 'sidebar.name', { max: 64 }),
      badge: sidebarBadge,
    },
    hero: {
      title: textAt(hero.title, 'hero.title', { max: 64 }),
      badge: heroBadgeAt(hero.badge),
      mark: markAt(hero.mark, 'hero.mark'),
    },
  };
}

/** Read and validate one SVG asset; missing files, foreign formats and oversized bytes fail the build. */
async function readAsset(root, name) {
  const target = new URL(`assets/${name}`, root);
  let info;
  try {
    info = await stat(target);
  } catch {
    throw new Error(`brand 素材缺失：assets/${name}`);
  }
  if (!info.isFile()) throw new Error(`brand 素材不是文件：assets/${name}`);
  if (info.size > MAX_ASSET_BYTES) {
    throw new Error(`brand 素材超过 256KB：assets/${name}（${String(info.size)} 字节）`);
  }
  const source = await readFile(target, 'utf8');
  if (!SVG_ROOT.test(source)) throw new Error(`brand 素材不是 SVG：assets/${name}`);
  return source;
}

/** Resolve the JSON plus embedded assets into the constants the Client half imports. */
export async function loadBrandConfig(root = PACKAGE_ROOT, { desktopManifest = DESKTOP_MANIFEST } = {}) {
  let raw;
  try {
    raw = JSON.parse(await readFile(new URL(CONFIG_FILE, root), 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`brand.config.json 不是合法 JSON：${error.message}`);
    throw new Error(`无法读取 brand.config.json：${error.message}`);
  }
  const config = readConfig(raw);
  const sidebarSvg = config.sidebar.mark.asset === null ? null : await readAsset(root, config.sidebar.mark.asset);
  const heroSvg = config.hero.mark.asset === null ? null : await readAsset(root, config.hero.mark.asset);
  const { mode, text } = config.hero.badge;
  const label = mode === 'version'
    ? formatVersionBadge(await readDesktopVersion(desktopManifest))
    : mode === 'text' ? text : null;
  return {
    ...config,
    sidebar: { ...config.sidebar, mark: { ...config.sidebar.mark, svg: sidebarSvg } },
    hero: {
      ...config.hero,
      badge: { mode, text, label },
      mark: { ...config.hero.mark, svg: heroSvg },
    },
  };
}

/** Deterministic module source; no timestamps, so unload/reload stays byte-identical. */
export function renderModule(config) {
  return [
    '// Generated by apps/web/scripts/build-brand.mjs from brand.config.json. Do not edit by hand.',
    `export const BRAND = ${JSON.stringify(config, null, 2)} as const;`,
    'export type BrandConfig = typeof BRAND;',
    '',
  ].join('\n');
}

async function generate(root) {
  const config = await loadBrandConfig(root);
  await mkdir(fileURLToPath(new URL('src/generated/', root)), { recursive: true });
  await writeFile(new URL(GENERATED_FILE, root), renderModule(config));
  return config;
}

async function bundle(root) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('src/client.tsx', root))],
    bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022',
    external: ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react/jsx-runtime'],
  });
  await mkdir(fileURLToPath(new URL('dist/', root)), { recursive: true });
  await writeFile(new URL('dist/client.browser.js', root), `window.__ModuleLoader__.load({id: "workdsh-plugin-brand", factory: function(require) {
const module = { exports: {} };
${result.outputFiles[0].text}
return module.exports;
}});
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = PACKAGE_ROOT;
  const config = await generate(root);
  if (!process.argv.includes('--generate-only')) await bundle(root);
  console.log(`brand: ${config.hero.title} / badge=${config.hero.badge.label ?? '(hidden)'}`);
}
