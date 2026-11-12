# 交接文档：WorkDSH 品牌替换与会话首屏定制

> **读者**：接手本任务的其他模型/工程师。
> **状态**：仅完成调研与方案设计，**尚未写任何产品代码**（`packages/plugins/brand` 不存在）。
> **已有产物**：本文件 + 同目录 `spec.md`（规格）+ `tasks.md`（任务清单）。
> **交接日期**：2026-11-12（调研基于 2026-11-09 的代码状态）。

---

## 0. 一句话任务

在 WorkDSH（基于官方 DeepSeek Harness 的桌面端）里，用一个**自研 Cordis 插件**替换产品品牌标识，并自定义新会话首屏（hero）区域，**不改官方包文件**。

---

## 1. 背景与版本锁定

- 仓库：`/Users/wangfenglin/projects/workdsh`（WorkDSH Desktop + Web）。
- 官方 DSH 版本：`0.2.1-rc.5`，锁在 `upstream.json` 的 `version` 字段。所有 `@deepseek-ai/dsh-*` 包必须是这个精确版本，`@deepseek-ai/cordis` 为 `4.0.5`。
- Desktop 只是 Electron 载体，DSH Host/Client 全部来自官方已发布 npm 包；WorkDSH 的定制在 `packages/` 下的自有插件里，通过 `packages/bundle/cordis.patch.yml` 注册。
- 两个工作区：
  - 根：Yarn 4（`nodeLinker: node-modules`），只管 `apps/desktop`。
  - `apps/web`：独立 pnpm workspace，`pnpm-workspace.yaml` 覆盖 `../../packages/*`、`../../packages/plugins/*`，所有自有插件在这里构建。
- 官方包真实路径（版本号带 pnpm 哈希，用命令定位，别硬编码）：

```bash
P=apps/web/node_modules/.pnpm
ls -d $P/@deepseek-ai+dsh-client-ui-conversation@*/node_modules/@deepseek-ai/dsh-client-ui-conversation
```

---

## 2. 需求原文（用户描述，附结构还原）

用户提供两张截图，此处结构化描述，供无法看图者使用。

### 图一：官方 DSH 对话页

- **区域 1（侧栏左上角）**：鲸鱼图形 + `deepseek` 字标 + `HARNESS` 徽标（字标与徽标同属一段矢量图）。
- **区域 2（会话首屏中部，输入框上方）**：鲸鱼图形 + 大标题「探索未至之境」+ 右侧小徽标「预览版」。

问题：项目引用官方插件，这些品牌元素全是 DeepSeek 的。

### 图二：WorkBuddy 对话页（目标形态）

首屏输入框上方一整块区域，作为**一个设计整体**：

1. 大标题「WorkBuddy，我帮你」；
2. 分段 tab 行（办公 / 开发 / 设计）；
3. chips 行（日常开发 / 开发网站 / 小程序 / Agent 应用 / 开发 Skill / 技术文档）；
4. 右侧吉祥物；
5. 以上元素的对齐、间距、整体居中。

### 需求拆分

| 编号 | 内容 |
|---|---|
| 需求一 | 替换区域 1 与区域 2 的 logo、文字、徽标；要能完全控制样式 |
| 需求二 | 自定义首屏内容与布局，向图二（WorkBuddy 式整屏 hero）靠齐 |

---

## 3. 已核实的技术事实

以下全部为**读代码得出**，可复核；未经验证的推断会显式标注。

### 3.1 槽位清单（`@deepseek-ai/dsh-client-ui-*@0.2.1-rc.5`）

| 槽名 | kind / scope | 传入 props | 官方 fallback |
|---|---|---|---|
| `sidebar.brand.mark` | single / root | `{size: 24}` | `FishLogo` |
| `sidebar.brand.name` | single / root | `{}` | `BrandWordmark` |
| `sidebar.toggle.badge` | single / root | — | 折叠态徽标 |
| `conversation.hero.brand.mark` | single / root | `{size: 34, className: '<hash>_fish'}` | `HeroFish`（SMIL 动画 + hover） |
| `conversation.hero.workspace` | single / root | — | 工作区行 |
| `conversation.hero.agentPreset` | single / session-maybe | — | 模式选择 |
| `conversation.hero.options` | list / session | — | — |
| `conversation.input.dock` | list / session | — | — |
| `conversation.composer` | chain / session | — | 官方输入框 |
| `settings.section` | list | — | — |
| `shell.overlay` | — | — | — |
| `workdsh.workbench.frame` | 自有 | — | 见 3.5 |

关键代码（sidebar 包 `lib/client.js`）：

```js
// 展开态
jsx("span", { className: ...brandMark, children: renderSlot("sidebar.brand.mark", {size: 24}, {fallback: jsx(FishLogo, {size: 24})}) })
jsx("span", { className: ...brandName, children: renderSlot("sidebar.brand.name", {}, {fallback: ...BrandWordmark}) })
// 折叠态（rail）
jsx("span", { className: ...railMark, children: renderSlot("sidebar.brand.mark", {size: 24}, {fallback: jsx(FishLogo, {size: 24})}) })
```

→ 两态**共用同一个槽**，一次注册覆盖两态。

hero（conversation 包 `lib/client.js`）：

```js
renderSlot("conversation.hero.brand.mark", { size: 34, className: HeroShell_module_css_default.fish }, { fallback: jsx(HeroFish, {hovering}) })
```

### 3.2 官方样式实际值（决定"样式能改到什么程度"）

```css
/* sidebar */
.brandName { height:24px; font-size:18px; font-weight:600; line-height:24px; letter-spacing:.04em; gap:6px; display:inline-flex }
.brandMark { display:inline-flex; flex:none; transform:translate(1px) }
.railMark  { display:none } /* 折叠态改为 inline-flex */

/* conversation hero */
.headline     { color:var(--dsw-alias-label-primary); font-size:26px; font-weight:500; line-height:32px;
                gap:12px 10px; justify-content:center; flex-wrap:wrap; display:flex }
.titleGroup   { gap:4px 7px; justify-content:center; flex-wrap:wrap; display:flex }
.previewBadge { font-family:var(--ds-font-family-code); font-size:12px; font-weight:500; line-height:18px;
                border:.5px solid var(--dsw-alias-interactive-bg-hover); border-radius:999px;
                background:var(--dsw-alias-state-business-tertiary); color:var(--dsw-alias-label-primary-bluish) }
.fish         { color:var(--dsw-alias-label-primary); display:block; transform-origin:50% 60%; overflow:visible }
```

标题文字所在的 `span` **没有任何 class**，纯继承 `.headline`。

**结论**：占槽元素 100% 可控；`.titleGroup` 内的大标题与「预览版」徽标**不在任何槽里**，只能改文案（靠语言包），字号/字重/字距/间距/居中全部改不了。

### 3.3 语言包限制（`@deepseek-ai/dsh-client-locale`）

```js
throw new Error(`locale namespace "${ns}" already has locale "${locale}"`)   // 同 (ns, lang) 二次注册直接抛错
throw new Error(`locale "${candidate.id}" is already registered`)
throw new Error(`locale "${current.id}" fallback chain does not reach "en"`) // fallback 链必须最终到达 en
```

→ 无法覆盖 `conversation/zh` 的 `hero.headline`。只能用 `addLanguage({id:'zh-workdsh', label, fallback:'zh'})` 另开一个语言 id，代价是设置里多一个语言选项，用户切回中文即还原。

### 3.4 硬编码

- `@deepseek-ai/dsh-client-ui-layout`：`productTitle = "DeepSeek Harness"` 是字面量，无槽无配置，只能改写 `document.title`。
- OS 应用名、图标、原生菜单不在插件能力范围内。

### 3.5 现有补丁机制（重要约束，见第 8 节）

`scripts/native-workbench-frame-patch.mjs` + `scripts/native-workbench-frame-patch.json`（`apps/web/scripts/` 下有同源副本）：

- 对官方 `dsh-client-ui-conversation/lib/client.js` 做**字节级精确替换**，当前 6 处 replacement；
- `originalSha256` / `patchedSha256` 双锁定，未知字节 **fail closed**；
- 支持 `--rollback`；
- Desktop 侧 `prepare` 阶段应用，`afterPack` 用 `verifyNativeWorkbenchFrame` 读**实际打包 Resources** 校验。

这套机制在本仓被称作"接缝（seam）"。`AGENTS.md` 目前**只授权两处外框接缝**。

另有自有槽 `workdsh.workbench.frame`（`packages/plugins/workbenches/src/client/native-frame.tsx`），它包住整个 `main.conversation`，职责是"业务页 vs 原生会话"切换。**不要把 hero 塞进这个槽**，会破坏 Portal 布局。

---

## 4. 两个社区插件的拆解（为什么各只能做一半）

交接时在 `~/.dsh/profiles/desktop/node_modules/` 下观察到：

### dsh-brand-studio 0.0.3

- 机制：注册官方槽并带 `priority:-10` 覆盖官方 occupant；`document.title` 写保护（带频率熔断）；配套 `settings.section` 面板。
- 能：侧栏 logo / 名称 / 徽标 / 字标图。
- 不能：hero 文案；hero logo 必须上传且**与侧栏共用同一份配置**，不能独立控制。
- 失效条件：官方改槽名或 priority 语义。

### dsh-hero-custom 1.0.1

- 机制：`MutationObserver` + 直接写 `textContent` + 按哈希类名写 CSS（`.pXSMma_*` / `[class*="_headlineText"]`），状态存 `$DSH_HOME/hero-custom.settings.json`。
- 能：hero 标题文案、徽标显隐、鲸鱼大小/颜色/动画（游动、弹跳、旋转）。
- 不能：**替换鲸鱼图形**（它把官方 `HeroFish` 当普通 DOM 改样式，没走 `conversation.hero.brand.mark` 槽）；不能重排、不能加内容。
- 失效条件：哈希前缀变化、中文文案改动、切英文界面（兜底靠匹配字面量「探索未至之境」）、React 重挂载。

**结论**：两者的能力缺口不是实现水平问题，而是**一个占槽、一个改 DOM**，各自只覆盖一类机制。合并成一个自研插件即可同时吃下两个需求。

---

## 5. 三条路线对比

| 路线 | 能力 | 代价 | 是否可行 |
|---|---|---|---|
| **A 纯官方槽** | 需求一 100%；需求二约 80%（内容只能落在官方标题**之下**，顺序被钉死） | 零授权、升级安全 | ✅ 立即可做 |
| **B 第三接缝** | 整块 hero 交给自己的组件，任意排版 | 需授权、DSH 升级需重锚 + 重算 SHA + 真机验收 | ⏸ 需用户拍板 |
| **C DOM/CSS 注入** | 视觉最自由 | 最脆（哈希类名、中文匹配、React 抢 DOM） | ❌ 不进产品 |

已否决的第四种：fork / 替换 `dsh-client-ui-conversation`，等于自研 Composer、轨迹、权限、文件侧栏，且违反 `AGENTS.md` 的"preserve the complete native Conversation"。

---

## 6. 推荐架构

**一个插件包、双面（dual-face）、一个设置面板、四个槽起步。**

```
packages/plugins/brand/            (name: workdsh-plugin-brand)
├── package.json        dsh.bundle.patch + dsh.client.inject（参照 model-market）
├── cordis.patch.yml    - insert: [{id: workdsh-brand, name: workdsh-plugin-brand}]
├── src/index.ts        Host 入口
├── src/shared.ts       zod 配置 schema + 默认值
├── src/service.ts      配置服务（Storage Domain，按账号隔离）
├── src/connection-api.ts   Client→Host RPC（get/set/reset/upload）
├── src/client.tsx      apply()：注册全部槽
├── src/client/SidebarBrand.tsx   mark / wordmark / badge
├── src/client/HeroMark.tsx       独立配置的 hero logo
├── src/client/panel.tsx          settings.section
└── src/client/styles.ts          只用 --dsw-alias-* 与 packages/ui tokens
apps/web/scripts/build-brand.mjs    参照 build-model-market.mjs（__ModuleLoader__ 包裹）
```

### 设计决策（已在 spec.md 中固化）

1. **用 `priority: -10` 覆盖，不 disable 官方品牌插件**：保留 fallback 语义，卸载即还原。
2. **两区域配置完全独立**：`brand.sidebar` / `brand.hero` 各自一套，避免两个插件争同一份配置。
3. **存储走 `@deepseek-ai/dsh-storage-domain`**，按账号隔离，不写 `$DSH_HOME` 单文件。
4. **资源 ≤ 256 KB**，仅接受内联 SVG 或本地图片转 dataURL，不接受远程 URL（内网离线场景）。
5. **样式纪律**：只用 `--dsw-alias-*` 与 `packages/ui` 的 `tokens`；CI 加 grep 断言，产物中不得出现 `pXSMma` / `_headlineText` 等哈希类名。
6. **D7 双轨挂载**：hero 组件做成纯展示组件，Phase 2 挂 `conversation.input.dock`，Phase 3 授权后改挂新容器槽，组件不返工。
7. **D8 不使用语言包**：区域二文案保持官方原文，文案与排版一起留给 Phase 3。理由见 3.3。

### 需求二在纯槽路线下的落位

| 图二元素 | 落点 | 限制 |
|---|---|---|
| tab 行 / chips 行 | `conversation.input.dock`（list，可多次追加） | 只能落在官方标题与工作区行之下 |
| 吉祥物 | `shell.overlay` | 浮层，非布局流，需自行对齐窗口尺寸 |
| 大标题 | 无槽 | 文案可改（语言包），样式不可改 |
| 整体顺序 / 留白 / 居中 | 无槽 | 这正是"那 20%" |

---

## 7. 开发计划（详见 `tasks.md`，40 项）

| 阶段 | 内容 | 说明 |
|---|---|---|
| **Phase 0** 探针 | 3 条假设必须实测 | 见 7.1，不通过就改方案 |
| **Phase 1** 骨架 + 需求一 | 新包 + 四槽 + 设置面板 | 侧栏两态 + hero logo 全部可样式化 |
| **Phase 2** 需求二（纯槽） | dock 的 tab/chips + overlay 吉祥物 | 无需授权 |
| **Phase 3** 整屏 hero | 第三接缝 + 组件改挂 | **需用户授权** |
| **Phase 4** 收尾 | README、CI 断言、`yarn check`、回滚演练 | — |

### 7.1 Phase 0 必须先验证的三件事（**目前均未经验证**）

1. 首屏 `sessionId === void 0` 分支下，`conversation.hero.brand.mark`（`scope: root`）是否真的渲染。**未验证**。
2. `priority: -10` 是否确实压过官方 occupant（slots 语义为非链槽按 priority 升序取最低者，但未实测）。**未验证**。
3. 卸载/禁用插件后官方 fallback 是否立即且完整回归（无残留 style / attribute / 定时器）。**未验证**。

若第 1 条为否，Phase 2 的承载点改为 `shell.overlay` + `input.dock` 组合，Phase 3 优先级上调。

### 7.2 登记点（新包必须同步，共 3 处）

1. `apps/web/package.json`：`build` / `typecheck` 链末尾追加 `--filter workdsh-plugin-brand`，新增 `test:brand`；
2. `packages/bundle/cordis.patch.yml`：insert 列表加一行；
3. `apps/web/pnpm-workspace.yaml`：已覆盖 `../../packages/plugins/*`，**无需修改**。

---

## 8. 硬约束（来自 `AGENTS.md`，违反即不可合并）

1. **不改官方包文件。** Phase 1/2 不得新增任何接缝；Phase 3 的接缝必须走既有字节锁定机制，且需用户明确授权。
2. **不搬官方 DOM、不替换 `main.conversation`**，保留完整原生会话（Composer、轨迹、权限、文件侧栏）。
3. **不写 `docs/`**：`check:bilingual-docs` 会要求 `.en.md` 配对与记录一致性。
4. **配置按账号隔离**，不写 `$DSH_HOME` 单文件。
5. **不写全局 CSS 覆盖哈希类名**（`dsh-hero-custom` 的老路）。
6. 构建、类型检查、单测、Loader smoke 必须 **headless 安全**（不得隐式启动 GUI）。

---

## 9. 验收标准

- 侧栏展开/折叠两态均显示自定义 mark + 字标 + 徽标，无官方残留。
- hero logo 可独立于侧栏配置。
- 禁用插件后 `FishLogo` / `BrandWordmark` / `HeroFish` 完整回归，DOM 无残留。
- 浅色 / 深色 / 跟随系统三态正确，颜色全部来自 token。
- 产物无哈希类名选择器（grep 断言进 CI）。
- 切会话、进出设置页、折叠侧栏均无闪烁或重复挂载。
- `corepack yarn check` 全绿（layout / alignment / 双语 / 各包 typecheck + test）。
- Phase 3 额外：`--rollback` 后官方 hero 完整恢复；SHA 校验 fail-closed 生效；真机 UI 验收通过。

---

## 10. 待决事项（开工前需用户拍板）

1. **是否授权 Phase 3 第三接缝**（给 `HeroShell` 加容器槽）。不授权则只做 Phase 1+2。
2. **区域二文案**：接受 D8（Phase 1/2 不改字），还是先走语言包改字。
3. **配置存储**：确认按 Storage Domain + 账号隔离实现。
4. **品牌资产**：只支持用户上传/内联 SVG，还是需要内置一套预设占位图。

---

## 11. 术语表（本讨论中固定含义）

| 术语 | 含义 |
|---|---|
| 扩展点 / slot | 官方预留的合法插入口，无需改官方文件 |
| 声明 / occupant / fallback | 槽的定义 / 注册进去的组件 / 无人占用时的官方默认内容 |
| single / list / chain | 只显示优先级最低的一个 / 追加多个 / 沿链合成 |
| 接缝（seam） | 官方没留扩展点、必须改官方文件才能开出的口子；本仓特指字节锁定补丁 |
| 双面插件 | 一个包分 Host 半（Node 主进程）与 Client 半（浏览器） |
| Profile | 一套插件组合 + 配置，如 `~/.dsh/profiles/desktop` |
| Storage Domain | 按组织/账号隔离的原生存储域 |
| hero | 前端术语 hero section，本项目特指**新会话首屏、输入框上方的主视觉区**；也是组件名、状态名、槽名前缀 |
| `hero` 状态 | `sessionId === void 0 \|\| (shellPhase === 'blank' && …)` |

---

## 12. 复核命令（接手后建议先跑一遍）

```bash
cd /Users/wangfenglin/projects/workdsh
P=apps/web/node_modules/.pnpm

# 1) 锁定版本
python3 -c "import json;print(json.load(open('upstream.json'))['version'])"

# 2) 槽位与 CSS 原文
D=$(ls -d $P/@deepseek-ai+dsh-client-ui-conversation@*/node_modules/@deepseek-ai/dsh-client-ui-conversation)
grep -o "conversation\.hero\.[a-zA-Z.]*" $D/lib/client.js | sort -u
grep -o "\.pXSMma_headline{[^}]*}" $D/lib/client.js

# 3) 侧栏槽与品牌区 CSS
S=$(ls -d $P/@deepseek-ai+dsh-client-ui-sidebar@*/node_modules/@deepseek-ai/dsh-client-ui-sidebar)
grep -o "sidebar\.brand\.[a-zA-Z]*" $S/lib/client.js | sort -u
grep -o "Xa_brandName{[^}]*}" $S/lib/client.js | head -2

# 4) 语言包抛错点
L=$(ls -d $P/@deepseek-ai+dsh-client-locale@*/node_modules/@deepseek-ai/dsh-client-locale)
grep -o 'locale namespace[^`]*' $L/lib/client.js

# 5) 现有补丁规格
python3 -c "import json;d=json.load(open('scripts/native-workbench-frame-patch.json'));print(len(d['replacements']),'replacements')"
```

---

## 13. 一句话交给下一个模型

**做的是"插件"，不是"会话"**：占 4 个官方槽即可完整交付需求一；需求二用 `input.dock` + `shell.overlay` 拿到八成；剩下两成（整块 hero 的自排版权）只能靠用户授权的第三接缝，且必须先过 Phase 0 的三条实测。
