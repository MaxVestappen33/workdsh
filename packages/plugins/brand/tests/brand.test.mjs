import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadBrandConfig, renderModule } from '../../../../apps/web/scripts/build-brand.mjs';

const PACKAGE_ROOT = new URL('../', import.meta.url);
const DESKTOP_MANIFEST = new URL('../../../../apps/desktop/package.json', import.meta.url);

const VALID = {
  sidebar: { mark: { size: 22, asset: null }, name: '警务助手', badge: { visible: false, text: '' } },
  hero: { title: '警务助手', badge: { mode: 'version' }, mark: { size: 25, asset: null } },
};

async function fixture(config = VALID, assets = {}, desktopVersion = '1.0.3') {
  const directory = await mkdtemp(join(tmpdir(), 'workdsh-brand-'));
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'brand.config.json'), JSON.stringify(config));
  const manifest = join(directory, 'desktop-package.json');
  await writeFile(manifest, JSON.stringify({ name: 'dsh-plugin-desktop', version: desktopVersion }));
  for (const [name, body] of Object.entries(assets)) await writeFile(join(directory, 'assets', name), body);
  return { root: pathToFileURL(`${directory}/`), desktopManifest: pathToFileURL(manifest), directory };
}

const load = ({ root, desktopManifest }) => loadBrandConfig(root, { desktopManifest });

test('默认配置：侧栏 22px、hero 25px、「警务助手」，气泡显示产物版本号', async () => {
  const desktop = JSON.parse(await readFile(DESKTOP_MANIFEST, 'utf8'));
  const config = await loadBrandConfig(PACKAGE_ROOT);
  assert.equal(config.sidebar.mark.size, 22);
  assert.equal(config.sidebar.mark.svg, null);
  assert.equal(config.sidebar.name, '警务助手');
  assert.equal(config.sidebar.badge.visible, false);
  assert.equal(config.hero.title, '警务助手');
  assert.equal(config.hero.badge.mode, 'version');
  assert.equal(config.hero.badge.label, `v${desktop.version}`);
  assert.equal(config.hero.mark.size, 25);
  assert.equal(config.hero.mark.svg, null);
});

test('气泡三种状态：version / text / hidden', async () => {
  const versioned = await fixture();
  try {
    assert.equal((await load(versioned)).hero.badge.label, 'v1.0.3');
  } finally {
    await rm(versioned.directory, { recursive: true, force: true });
  }

  const fixed = structuredClone(VALID);
  fixed.hero.badge = { mode: 'text', text: '内测' };
  const texted = await fixture(fixed);
  try {
    const config = await load(texted);
    assert.equal(config.hero.badge.mode, 'text');
    assert.equal(config.hero.badge.label, '内测');
  } finally {
    await rm(texted.directory, { recursive: true, force: true });
  }

  const unset = structuredClone(VALID);
  unset.hero.badge = { mode: 'hidden' };
  const hidden = await fixture(unset);
  try {
    assert.equal((await load(hidden)).hero.badge.label, null);
  } finally {
    await rm(hidden.directory, { recursive: true, force: true });
  }
});

test('版本号取自产物清单，已带 v 前缀时不重复添加', async () => {
  const plain = await fixture(VALID, {}, '1.0.3');
  try {
    assert.equal((await load(plain)).hero.badge.label, 'v1.0.3');
  } finally {
    await rm(plain.directory, { recursive: true, force: true });
  }

  const prefixed = await fixture(VALID, {}, 'v2.0.0');
  try {
    assert.equal((await load(prefixed)).hero.badge.label, 'v2.0.0');
  } finally {
    await rm(prefixed.directory, { recursive: true, force: true });
  }

  const invalid = await fixture(VALID, {}, '');
  try {
    await assert.rejects(load(invalid), /缺少有效 version/u);
  } finally {
    await rm(invalid.directory, { recursive: true, force: true });
  }
});

test('生成的模块是确定性的，且包含编译期固化后的配置', async () => {
  const config = await loadBrandConfig(PACKAGE_ROOT);
  const first = renderModule(config);
  assert.equal(first, renderModule(await loadBrandConfig(PACKAGE_ROOT)));
  assert.match(first, /export const BRAND = /);
  assert.match(first, /"mode": "version"/);
  assert.match(first, /"label": "v/u);
});

test('assets 里的 SVG 会被读入常量，非 SVG 与超限文件在构建期失败', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
  const withAsset = structuredClone(VALID);
  withAsset.hero.mark.asset = 'mark.svg';
  const ok = await fixture(withAsset, { 'mark.svg': svg });
  try {
    const config = await load(ok);
    assert.equal(config.hero.mark.svg, svg);
    assert.equal(config.sidebar.mark.svg, null);
  } finally {
    await rm(ok.directory, { recursive: true, force: true });
  }

  const missing = await fixture(withAsset);
  try {
    await assert.rejects(load(missing), /素材缺失/u);
  } finally {
    await rm(missing.directory, { recursive: true, force: true });
  }

  const notSvg = await fixture(withAsset, { 'mark.svg': '<html></html>' });
  try {
    await assert.rejects(load(notSvg), /不是 SVG/u);
  } finally {
    await rm(notSvg.directory, { recursive: true, force: true });
  }

  const oversized = await fixture(withAsset, { 'mark.svg': `<svg>${'x'.repeat(256 * 1024)}</svg>` });
  try {
    await assert.rejects(load(oversized), /超过 256KB/u);
  } finally {
    await rm(oversized.directory, { recursive: true, force: true });
  }
});

test('字段类型、未知字段与素材路径都按构建期错误处理', async () => {
  const cases = [
    [{ ...VALID, extra: {} }, /未知字段 extra/u],
    [{ ...VALID, sidebar: { ...VALID.sidebar, name: '' } }, /不能为空/u],
    [{ ...VALID, hero: { ...VALID.hero, title: 7 } }, /必须是字符串/u],
    [{ ...VALID, hero: { ...VALID.hero, badge: { mode: 'banner' } } }, /必须是 version \/ text \/ hidden/u],
    [{ ...VALID, hero: { ...VALID.hero, badge: { mode: 'text' } } }, /mode=text 时必须提供/u],
    [{ ...VALID, hero: { ...VALID.hero, badge: { mode: 'version', text: '预览版' } } }, /只有在 mode=text 时才允许设置/u],
    [{ ...VALID, hero: { ...VALID.hero, badge: { mode: 'text', text: '一'.repeat(17) } } }, /长度不能超过 16/u],
    [{ ...VALID, sidebar: { ...VALID.sidebar, mark: { size: '22', asset: null } } }, /必须是整数/u],
    [{ ...VALID, sidebar: { ...VALID.sidebar, mark: { size: 22, asset: '../mark.svg' } } }, /不含路径/u],
    [{ ...VALID, sidebar: { ...VALID.sidebar, badge: { visible: true, text: '' } } }, /可见时不能为空/u],
  ];
  for (const [config, expected] of cases) {
    const trial = await fixture(config);
    try {
      await assert.rejects(load(trial), expected);
    } finally {
      await rm(trial.directory, { recursive: true, force: true });
    }
  }
});

test('HeroShell 接缝只替换标题区，气泡读取配置标签并保留官方回退', async () => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url));
  const spec = JSON.parse(await readFile(join(repository, 'scripts/native-workbench-frame-patch.json'), 'utf8'));
  const seam = spec.replacements.find(([, after]) => after.includes('__WORKDSH_BRAND__'));
  assert.ok(seam, '缺少 hero 标题区接缝');
  const [before, after] = seam;
  assert.match(before, /t\("hero\.headline"\)/u);
  assert.match(before, /previewBadge/u);
  assert.doesNotMatch(before, /conversation\.hero\.brand\.mark|workspaceRow|Composer/u);
  assert.match(after, /__WORKDSH_BRAND__\?\.hero\.title \?\? t\("hero\.headline"\)/u);
  assert.match(after, /__WORKDSH_BRAND__\?\.hero\.badge\.label === null \? null/u);
  assert.match(after, /__WORKDSH_BRAND__\?\.hero\.badge\.label \?\? t\("hero\.preview"\)/u);
});
