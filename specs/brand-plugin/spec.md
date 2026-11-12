# 品牌替换与会话首屏定制（规格）

## 1. 目标与范围

一个自研插件 `workdsh-plugin-brand`（目录 `packages/plugins/brand`），同时承担两个需求：

- **需求一（品牌替换）**：替换侧栏 logo、产品字标、徽标，以及会话首屏 hero 位的 logo。全部通过官方槽位完成，不改官方包文件。样式完全自主。
- **需求二（首屏定制）**：
  - Phase 2：用 `conversation.input.dock` / `shell.overlay` 在官方 hero 之下追加 tab 行、chips 行、吉祥物浮层——不需要任何授权。
  - Phase 3：把整块 hero 的排版权拿到手（WorkBuddy 式大标题 + tab + chips + 吉祥物一体化布局）。**这一步需要新增第三接缝，须单独授权。**

### 不在范围内

- 不改 hero 标题样式（`.pXSMma_headline` 26/500/32、`.previewBadge` 12px 等宽）：Phase 1/2 明确不做，Phase 3 随容器槽一并解决。
- 不改 OS 应用名、图标、原生菜单；`ui-layout` 的 `productTitle = "Harness"` 是硬编码字面量。
- 不接管 Composer、会话轨迹、权限、文件侧栏；不替换 `main.conversation`。
- 不修改 `docs/`（双语校验会连带要求 `.en.md` 与记录一致性）。

### 硬约束（继承 `AGENTS.md`）

1. 不改官方包文件。Phase 1/2 不得新增任何接缝；Phase 3 的接缝必须走既有 `native-workbench-frame-patch` 机制（字节锚定 + 双 SHA + fail-closed + 可 `--rollback`）。
2. 不搬官方 DOM、不替换官方会话树。
3. 配置按账号隔离存储，不写 `$DSH_HOME` 单文件（`dsh-hero-custom` 的做法不符合本仓规范）。
4. 不写全局 CSS 覆盖哈希类名（`.pXSMma_*` / `[class*="_headlineText"]`）。
5. 卸载后官方 fallback 必须完整回归，无残留 style / attribute / 定时器。

## 2. 已核实事实

### 2.1 官方槽位（`@deepseek-ai/dsh-client-ui-*@0.2.1-rc.5`）

| 槽 | kind | 传入 props | 官方 fallback |
|---|---|---|---|
| `sidebar.brand.mark` | single / root | `{size: 24}` | `FishLogo` |
| `sidebar.brand.name` | single / root | `{}` | `BrandWordmark` |
| `sidebar.toggle.badge` | single / root | — | 折叠态徽标 |
| `conversation.hero.brand.mark` | single / root | `{size: 34, className: '..._fish'}` | `HeroFish`（含 SMIL 动画 + hover） |
| `conversation.hero.workspace` | single / root | — | 工作区行 |
| `conversation.hero.options` | list / session | — | — |
| `conversation.input.dock` | list / session | — | — |
| `settings.section` | list | — | — |
| `shell.overlay` | — | — | — |

`sidebar.brand.mark` 在折叠态（`.railMark`）与展开态（`.brandIdentity`）**两处渲染同一个槽**，一次注册覆盖两态。

### 2.2 官方样式实际值（决定了样式控制边界）

- `.brandName`（包住 `sidebar.brand.name` 的外层）：`height:24px; font-size:18px; font-weight:600; line-height:24px; letter-spacing:.04em; gap:6px`。占槽者在内可覆盖字号字重，但**可用高度被钉在 24px**。
- `.pXSMma_headline`：`font-size:26px; font-weight:500; line-height:32px; gap:12px 10px; justify-content:center`；标题文字所在 `span` 无 class，纯继承 → **样式不可控**。
- `.pXSMma_previewBadge`：`font-family:var(--ds-font-family-code); font-size:12px; font-weight:500; line-height:18px; border-radius:999px`。
- `.pXSMma_fish`（hero 槽传入的 className）：`color:var(--dsw-alias-label-primary); display:block; transform-origin:50% 60%`。占槽者可忽略 `className` 与 `size`，但外层 `fishHitbox` 的 hover 监听仍由官方持有。

### 2.3 其他限制

- `dsh-client-locale` 的 `register(ns, locale)` 对同一 `(conversation, zh)` 二次注册**直接抛错**，无法覆盖 `hero.headline`；只能用 `addLanguage({id, fallback})` 新开一个语言 id。
- `ui-layout` 中 `productTitle` 为硬编码字面量，无槽无配置。

### 2.4 仓内参考实现

- `packages/plugins/model-market`：`dsh.client.immediately: true`、`settings.section` 带 `order` 的注册、`ctx.effect` 清理、`apps/web/scripts/build-model-market.mjs` 的 `__ModuleLoader__` 包裹、`node --test` 用例组织。
- `packages/plugins/workbenches`：Host 半 + Client 半双入口、`tsconfig.client*.json` 分体、`cordis.patch.yml` 形态。
- `packages/ui`：可复用 `LogoMark`、`Icon`、`Button/Input/Select`、`tokens`。

## 3. 设计决策

**D1 单包双面，一个设置面板。** Host 半管配置持久化与 RPC，Client 半在一次 `apply()` 内注册全部槽。两个区域共用一个 `settings.section`，避免 brand-studio 那种"两个插件抢同一槽"的结构性冲突。

**D2 用 `priority` 覆盖，不 disable 官方插件。** 所有 single 槽以 `priority: -10` 注册压过官方 occupant（slots 语义：非链槽按 priority 升序取最低者渲染）。保留官方 fallback 语义：插件卸载/禁用即自动还原。不使用 `packages/bundle/cordis.patch.yml` 的 `disabled: true` 关掉官方品牌插件——那会让 fallback 失效并影响其他品牌槽。

**D3 配置模型（两个区域完全独立）。**

```
brand.sidebar = { mark: Asset | Preset, wordmark: {mode:'text'|'svg', text?, svg?, font?, weight?, letterSpacing?, color?}, badge: {...}, visible: boolean }
brand.hero    = { mark: Asset | Preset, visible: boolean, hoverMotion: 'none'|'breathe'|'swim' }
```

Asset 支持内联 SVG 字符串或上传图片转 dataURL。关闭 `visible` 时该槽注册为空占用者，回到官方 fallback。

**D4 存储与隔离。** Host 半走 `@deepseek-ai/dsh-storage-domain`，按账号注入；Client 通过 `connection-api` 读写。禁止直接写 `$DSH_HOME` 文件。

**D5 资源体积。** 单个资源 ≤ 256 KB（Host 侧 zod 校验），超限拒绝并回传原因；不接受远程 URL（离线内网场景）。

**D6 样式纪律。** 只用内联 style / 组件内样式，颜色一律走 `--dsw-alias-*` 与 `packages/ui` 的 `tokens`。CI 加一条 grep 断言：产物中不得出现 `pXSMma`/`_headlineText` 等哈希类名选择器。

**D7 双轨挂载。** Hero 区域组件实现为纯展示组件，Phase 2 挂在 `conversation.input.dock`，Phase 3 授权后改挂 `workdsh.conversation.hero`，组件本身不返工。

**D8 语言包不使用。** 区域二文案在 Phase 1/2 保持官方原文（不改字）。理由是语言包方案会让"语言"里多出一个条目、用户切回中文即还原，收益不抵成本；文案与排版一起留给 Phase 3 处理。

## 4. 阶段与交付物

### Phase 0 · 探针验证（只读 + 一次性临时插件）

必须实测、不得假设的三条：

1. 首屏 `sessionId === void 0` 分支下 `conversation.hero.brand.mark` 是否渲染（`scope: root`，预期渲染）。
2. `priority: -10` 是否确实压过官方 occupant（预期是），且卸载后 fallback 立即回归。
3. 侧栏折叠/展开两态是否共用同一槽（预期是，`.railMark` 与 `.brandIdentity` 各调一次 `renderSlot`）。

产出：`specs/brand-plugin/probe.md`（三条结论 + 截图/日志）。若第 1 条为否，Phase 2 的承载点改为 `shell.overlay` + `input.dock` 组合方案，Phase 3 优先级上调。

### Phase 1 · 骨架 + 需求一（核心）

新增文件：

```
packages/plugins/brand/
  package.json              # name: workdsh-plugin-brand, dsh.bundle + dsh.client.inject
  cordis.patch.yml          # - insert: [{id: workdsh-brand, name: workdsh-plugin-brand}]
  tsconfig.json / tsconfig.client.json / tsconfig.client.build.json
  README.md
  src/index.ts              # Host 入口
  src/shared.ts             # zod 配置 schema + 默认值
  src/service.ts            # 配置服务（Storage Domain）
  src/connection-api.ts     # Client→Host RPC
  src/client.tsx            # apply()：槽注册
  src/client/SidebarBrand.tsx
  src/client/HeroMark.tsx
  src/client/panel.tsx      # settings.section
  src/client/styles.ts
  tests/config.test.mjs
  tests/registration.test.mjs
apps/web/scripts/build-brand.mjs   # 参照 build-model-market.mjs
```

登记点（3 处）：`apps/web/package.json` 的 `build`/`typecheck` 链 + 新增 `test:brand`；`packages/bundle/cordis.patch.yml` 的 insert 列表；`apps/web/pnpm-workspace.yaml` 已覆盖 `../../packages/plugins/*`，无需改。

能力：侧栏 logo/字标/徽标三槽 + hero logo 槽 + 一个设置面板（预览、上传、字号字重字距颜色、显隐开关、重置）。视觉完全自主，包含折叠/展开两态。

### Phase 2 · 需求二（纯槽部分）

- `conversation.input.dock`：tab 行 + chips 行，条目可配置（标题、图标、点击行为：回填输入框 / 直接发送）。
- `shell.overlay`：吉祥物或插画浮层（可关闭；不拦截鼠标事件）。
- 面板扩展：内容条目增删改、排序。
- 明确边界：内容只能落在官方标题与工作区行**之下**，顺序不由插件决定。

### Phase 3 · 整屏 hero（需授权）

- 在 `HeroShell` 内加一处容器槽：`renderSlot('workdsh.conversation.hero', {t, renderSlot}, {fallback: 官方 stack})`。
- 补丁 spec 新增一条 replacement、regenerate 双 SHA、`--rollback` 验证、Desktop `afterPack` 用 `verifyNativeWorkbenchFrame` 校验真实 Resources。
- Hero 组件从 `input.dock` 改挂新槽，完成大标题 + tab + chips + 吉祥物一体化排版；标题文案与样式一并自主。
- 真机 UI 验收（浅色/深色/窄窗/折叠侧栏）。

### Phase 4 · 收尾

README（不进 `docs/`）、`yarn check` 全绿、卸载与回滚演练、升级锚点说明写入 spec 附录。

## 5. 验收标准

- [ ] 侧栏展开与折叠两态均显示自定义 mark + 字标 + 徽标，无官方残留。
- [ ] 首屏 hero logo 可独立于侧栏配置，尺寸/颜色/动效可控。
- [ ] 禁用插件后，官方 `FishLogo` / `BrandWordmark` / `HeroFish` 完整回归，DOM 无残留 style/attribute。
- [ ] 深浅色（含跟随系统）三态下颜色正确，全部来自 token。
- [ ] 产物中无哈希类名选择器（grep 断言进 CI）。
- [ ] 切换会话、进出设置页、折叠侧栏均无闪烁或重复挂载。
- [ ] `yarn check`（layout / alignment / 双语 / 各包 typecheck + test）全绿。
- [ ] Phase 3 额外：`--rollback` 后官方 hero 完整恢复，SHA 校验 fail-closed 生效。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 官方升级改槽名或 priority 语义 | 槽名是公开契约，风险低；`preflight` 增加槽名断言 |
| 官方升级改 `HeroShell` 结构 | 仅影响 Phase 3；补丁 fail-closed 会在构建期报错，不会静默错位 |
| 上传资源过大导致配置膨胀 | Host 侧 256 KB 限制 + 面板提示 |
| 与用户已装的 brand-studio / hero-custom 冲突 | 装本插件前提示卸载那两个；同槽竞争时本插件 priority 更低，行为确定 |

回滚：Phase 1/2 仅需禁用/卸载插件；Phase 3 使用 `node scripts/native-workbench-frame-patch.mjs --rollback`。

## 7. 待决事项（需拍板后开工）

1. **Phase 3 是否授权第三接缝**：只做 Phase 1+2（今天即可开工），还是一次性做到整屏 hero。
2. **区域二文案**：接受 D8（Phase 1/2 保持官方原文）还是要求先改字（需走语言包，代价见 2.3）。
3. **配置存储**：Storage Domain（按账号隔离，符合规范）是否就按此实现。
4. **品牌资产来源**：只支持用户上传/内联 SVG，还是需要我先放一套内置预设（含你们的 logo 占位）。
