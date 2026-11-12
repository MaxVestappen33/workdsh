# 品牌（workdsh-plugin-brand）

部署级品牌替换：侧栏 logo / 字标 / 折叠态徽标，会话首屏 hero 图形与标题、预览版气泡。配置在**构建期**固化进产物，所有账号看到的一致；没有按账号存储、RPC、上传或设置面板。

## 配置

`brand.config.json`（唯一配置源）：

| 字段 | 说明 |
| --- | --- |
| `sidebar.mark.size` | 侧栏图形尺寸，默认 22（与改造前一致） |
| `sidebar.mark.asset` | `assets/` 下的 SVG 文件名；`null` 表示复用 `workdsh-ui` 的 `LogoMark` |
| `sidebar.name` | 侧栏字标文本 |
| `sidebar.badge.visible` / `.text` | 折叠态徽标；默认关闭 |
| `hero.mark.size` / `.asset` | 首屏图形尺寸（官方鲸鱼是 34×25，这里默认 25）与可选 SVG |
| `hero.title` | 首屏大标题文本 |
| `hero.badge.mode` | 标题右侧气泡：`version`（默认，构建期读 `apps/desktop/package.json` 的 `version`，渲染为 `v1.0.3`）、`text`（固定文案）、`hidden`（不显示） |
| `hero.badge.text` | 仅 `mode: "text"` 时必填，≤ 16 字符 |

## 槽位

- `sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.toggle.badge`、`conversation.hero.brand.mark`，全部 `priority: -10`。
- 注册走 `ctx.slots.inject`（内部即 `ctx.effect`），卸载后官方 `FishLogo` / `BrandWordmark` / `HeroFish` 原样回归。
- hero 标题与预览版气泡由第三处字节锁定接缝（`scripts/native-workbench-frame-patch.json`）控制：
  接缝只替换 `HeroShell` 的标题区，读取客户端 `apply()` 同步写入的 `globalThis.__WORKDSH_BRAND__`；
  全局缺失时退回官方 `t("hero.headline")` 与默认显示气泡。

## 构建与验证

```bash
corepack pnpm --filter workdsh-plugin-brand build
corepack pnpm --filter workdsh-plugin-brand typecheck
corepack pnpm --filter workdsh-plugin-brand test
```

`apps/web/scripts/build-brand.mjs` 读 JSON + 素材，生成 `src/generated/brand.ts` 并打包 `dist/client.browser.js`。缺文件、非 SVG、超过 256 KB、字段类型错误都会在构建期失败。
