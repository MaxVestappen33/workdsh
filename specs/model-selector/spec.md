# 会话模型选择器改造（WorkBuddy 风格）

状态：**客户端展示效果已实现并静态验收；档位真实调度、Auto 判档等后台能力待接入**。本文保留调研结论、扩展点证据与方案取舍；实现清单与后台排期见 `specs/model-selector/backend-todos.md`。

> 实现位置：`packages/plugins/model-market/src/client/model-select/`。用户 2026-11-18 显式授权替换官方会话模型选择器；Auto 与繁忙程度按用户要求只做展示效果，`/model` 命令暂不接管。

## 1. 需求

1. 点击输入框右侧模型入口，弹出全部可选模型；最上方预置三个档位（快速 / 均衡 / 极致，参考图顶部再加一个 Auto 开关）。
2. 鼠标悬停档位，右侧浮出二级说明面板（档位定位、消耗倍率等）。
3. 鼠标悬停具体模型，右侧浮出详情面板：模型描述、消耗倍率、繁忙程度、可设置上下文窗口、可选择思考强度。
4. 列表底部「配置本地模型」，跳转/打开模型管理并可添加本地自定义模型。

## 2. 结论

| 需求 | 可行性 | 关键约束 |
| --- | --- | --- |
| 1 三档 + 模型列表 | **可行**，但需要替换官方座位 | 官方 `conversation.input.model` 是 single 槽，占用即替换；治理上需显式授权 |
| 2 档位 hover 二级面板 | **可行** | 纯前端；档位数据需自建（官方无档位概念） |
| 3 模型 hover 详情 | **部分可行** | 思考强度可设（`reasoningEffort`）；上下文窗口**只能显示、无法按会话设置**；繁忙程度无官方数据源 |
| 3b 倍率 / 促销标签 | **可行但有前提** | 官方 catalog 只有 id/name/description/reasoning；倍率与标签必须来自本产品后端或本地配置 |
| 4 配置本地模型 | **可行** | 跳转设置可做：外壳未暴露 `openSection` 服务，但 `sidebar.settings` 条目的 store 座位 `create().actions.openSection(id)` 可直接打开到指定分区 |
| 5 Auto 开关 | **UI 可行，语义受限** | 服务端不做逐请求路由时，Auto 只能等于「使用默认模型/默认档位」 |

一句话：**界面能 1:1 复刻；"档位在后台真实调度模型"这件事，取决于我们是否在自己的后端/网关上实现，而不是改客户端就能得到。**

**已落地的实现结果**：Auto 开关 + 快速/均衡/极致三档 + 按 provider 分组的模型列表 + 底部「配置本地模型」；悬停档位/模型在右侧浮出二级详情（描述、消耗倍率、繁忙程度、思考强度、上下文窗口）；具体模型与思考强度真实调用官方 `select()`。Auto 与三档为展示态，倍率/标签/上下文来自 `meta.ts` 本地映射与确定性兜底，繁忙程度为演示值。

自定义模型入口（2026-11-18 调整）：点击后不再在选择器内嵌表单，而是先打开「设置 → 模型管理」，再由该页自动弹出「添加本地模型」弹窗。跳转经 `src/client/settings-nav.ts` 的 opener 完成（取 `sidebar.settings` 条目 store 座位的 `create().actions.openSection`），请求本身用同一模块的待处理标记跨树传递；模型管理页把表单统一改为居中弹窗（新增/编辑共用），按 Esc 只关弹窗、不连带关闭设置面板。

Auto 选中态（2026-11-18 调整）：开关打开后浮层收起成一张小卡片 —— 只剩 Auto 行（右侧开关为开启）+ 分隔线 + 一行说明「警务助手 基于效果与速度帮助您选择最优模型」；三档、模型列表、底部「配置本地模型」入口、右侧详情栏全部隐藏，浮层也不再为详情栏预留 300px。关掉开关即展开完整列表。

二级详情对齐（2026-11-18 调整）：右侧详情面板改为独立 `position: fixed`（脱离主面板 flex 流），顶边与**当前悬停行**的顶边对齐，并夹在视口内（`top = clamp(8, rowTop, vh - asideHeight - 8)`）；列表滚动、窗口缩放、面板内容高度变化（展开思考强度/上下文说明）都会重新对齐。这样鼠标从任意一行水平右移即可进入面板，不必斜穿列表，避免途经其他行导致详情跳变或面板"消失"。配套改动：点击外部判定需额外包含面板自身（它在 `pop` 之外），否则点面板内部会被误判为外部点击而关闭。

详情面板宽度（2026-11-18 调整）：由 300px 收窄到 **260px**，并改为 `box-sizing: border-box`。此前面板移出 `.wd-ms-pop` 后丢掉了 pop 作用域内的 `box-sizing: border-box`，声明 300px 实际渲染 334px（含 32px 内边距 + 2px 边框），而定位只按 300px 预留，导致面板右侧溢出/被裁；同步在 `ModelSelectSeat.tsx` 提为常量 `ASIDE_WIDTH = 260`，定位与样式共用同一数值，`asideLeft` 预先夹到 `width - ASIDE_WIDTH - 8`，不再在渲染期读视口宽度。窄屏媒体查询中把面板撑成 `100vw - 16px` 的死规则已删除（该分支本就不渲染面板）。

详情面板显示条件（2026-11-18 调整）：面板只在**指针停在某个档位/模型行上**时显示，指针移到分组标题、分隔线、列表空白、底部「配置本地模型」入口即收起。实现要点：
- 行（Auto / 三档 / 每个模型）打 `data-hover-row`；主面板 `onMouseMove` 里判断指针是否在行上，**不在行上但高度仍落在某一行的水平带内**（行两侧 6px 列表内边距）时保持显示——否则鼠标从行水平右移去面板会先经过该窄带而被误收，面板永远够不到。
- 主面板 `onMouseLeave`、面板 `onMouseLeave` 都会先用 `event.relatedTarget` 判断指针是不是**直接进了另一栏**：是则直接 return（不启动收起计时），只有离开「两栏整体」才按 160ms 兜底收起。这样即使移动很慢也不会掉面板。
- 关掉 Auto 开关时按 Auto 行立即显示详情（`toggleAuto(element)` 记录该行），不必等下一次移动。
- 文案「配置自定义模型」改为「配置本地模型」（`ModelSelectSeat.tsx` 及注释、`client.tsx` 注释、本文档同步）。

两栏间距（2026-11-18 调整）：二级面板由「主面板右侧 8px」改为**零间隙紧贴**（`asideLeft = position.left + mainWidth`，同时 `place()` 的预留宽度改为 `mainWidth + ASIDE_WIDTH`）。原先的 8px 间隙让指针在跨越时必须落在两栏之间，配 160ms 宽限仍有可能超时而隐藏；紧贴 + `relatedTarget` 短路后，指针从行水平右移是连续进入面板，路径上不存在"外部区域"。

## 3. 关键扩展点（已核实）

官方包位于 `apps/web/node_modules/.pnpm/@deepseek-ai+*`（0.2.1-rc.5）。

### 3.1 模型座位可被替换

`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`：

```ts
'conversation.input.model': { kind: 'single'; scope: 'session'; owner: InputControlOwnerProps };
```

single 槽语义（`dsh-client-ui-slots`）：*cell shadowing rank（ascending，default 0，lowest renders）* —— 低优先级注册遮蔽已存在的占用者，同优先级重复注册会抛错。

### 3.2 官方实现与注入面

`dsh-client-ui-model-selection/lib/client.js` 的注册方式：

```ts
ctx.inject(['slots', 'modelDirectories'], scope => {
  scope.slots.inject('conversation.input.model', () => scope.slots.register(
    { name: 'conversation.input.model', locale: 'model', children: { 'conversation.input.model.label': {...} },
      inject: sessionId => { const directory = models.directoryFor(sessionId); ... } },
    ModelSelect,
  ));
});
```

注入面 `ModelSelectInjected`：

| 成员 | 用途 |
| --- | --- |
| `available` | 子 Agent 会话为 false，官方此时返回 null |
| `directory` | `SnapshotStore<ModelDirectoryState>`：`current / groups / status / pending / error / routable` |
| `load()` | 触发 catalog 加载 |
| `select(selection)` | `{ provider, model, reasoningEffort? }`，落到 `session/selectModel` |

`ctx.modelDirectories`（`ModelDirectoryResolver`）是公开 Client Service，可 `directoryFor(sessionId)` 拿到同一份状态。**我们注册自己的座位可以拿到同一套能力，不需要改官方文件。**

### 3.3 可复用的既有做法

- `packages/plugins/account-settings`：占用官方 `settings.launcher`，已实际替换官方设置行 —— 说明"占用官方 single 槽"在本仓库有先例。
- `packages/plugins/model-market`：设置分区注册 + `MutationObserver` 视觉替换官方「模型」导航行；并已有可复用组件 `CustomModelForm.tsx`（props：`busy / error / initial / onSubmit / onCancel / onDiscover`）。
- `packages/plugins/projects`：用 `priority: -20` 注册空组件遮蔽其他插件条目 —— 遮蔽机制的现成用法。

## 4. 数据缺口（决定工作量的部分）

官方 `ModelCatalogModel` 只有：

```ts
{ id, name, description?, reasoning?: { efforts: {id,name,description?}[], defaultEffort? } }
```

WorkBuddy 面板需要的字段与来源：

| 字段 | 官方 | 可用来源 | 结论 |
| --- | --- | --- | --- |
| 名称 / 图标 / 分组 | 有（无图标） | 图标需自建映射（按 provider 或 model 前缀） | 需补 |
| 描述 | 有（可选） | 后端 model-market 也有 | 可用 |
| 消耗倍率 x0.15 | 无 | 后端模型目录 / 本地配置 | 需补 |
| 促销标签（夜间折扣/订阅优先/限时免费） | 无 | 后端标签 | 需补 |
| 繁忙程度 | 无 | **无任何官方信号**；需自建探测（健康检查或历史延迟统计） | 需自建，建议一期先不上 |
| 思考强度 | 有 `reasoning.efforts` | 官方 effort 菜单已有 | 可直接用 |
| 上下文窗口 | 无（在选择结果里） | provider 配置 `contextWindow` / 后端字段 | 只能显示 |

**重要限制**：`ModelSelection = { provider, model, reasoningEffort? }` 没有 contextWindow 字段。上下文窗口属于 provider 模型配置（`PiAiModelProfile.contextWindow`），改它是改全局模型配置，不是改本会话。所以"按会话切上下文档位"需要 Host 侧改造，属于越界范围，一期只能展示。

## 5. 三档与 Auto 的三种落法

| 方案 | 做法 | 优点 | 代价 |
| --- | --- | --- | --- |
| A 后端网关 | 后端暴露 3 个档位模型（如 `workdsh/fast|balanced|deep`），由后端在池内选真实模型；客户端只选档位 | 与 WorkBuddy 语义一致；可做逐请求调度、Auto 真实生效；倍率/繁忙可由后端返回 | 需要后端接口；需要把返回的"实际模型"回传展示 |
| B 客户端静态映射 | 档位 = 本地配置里的 `{provider, model}`，选中时 `select()` 映射后的真实模型 | 零后端改造，一天内可出效果 | 无池、无逐请求调度；Auto 只能是默认模型；真实模型会出现在 `/model` 与设置里 |
| C 纯展示分组 | 列表顶部做视觉分组，档位只是滚动锚点 | 成本最低、零风险 | 不满足"后台分配"诉求 |

**实际决策（2026-11-18）**：采用比 B 更轻的「纯展示态」——Auto / 快速 / 均衡 / 极致只切换触发器文案与选中态，**不调用 `select()` 改真实模型**；具体模型与思考强度仍真实调用官方 `select()`。这样界面可 1:1 验收，又不伪装出并不存在的「池内分配」能力。A（后端档位网关）作为后台排期，Auto 正式语义为「由网关按任务复杂度选档」，见 `backend-todos.md`。

## 6. 治理与风险

1. **治理（已闭环）**：用户 2026-11-18 显式授权替换官方模型选择器；`packages/plugins/model-market/README.md` 的边界描述与 `AGENTS.md` 的授权例外已同步。替换走公开插槽、不碰官方文件，卸载插件后官方选择器原样回归。
2. **旁挂替代方案**：`conversation.input.right` 是 list 槽，可在官方入口旁加一个自己的按钮。合规零冲突，但会出现两个模型入口。
3. **一致性**：`/model` 命令弹窗仍由官方渲染，会与新座位不一致（除非同时接管该 command）。
4. **升级耦合**：座位 props 变化会导致编译失败（fail closed），需纳入 `yarn check` 与界面冒烟。
5. **边界状态必须复刻**：`available === false`（子 Agent）返回 null；`status` 的 loading/error/selecting；`session/writer-held` → 「会话正在写入」提示。
6. **DOM 观察**：定位/隐藏元素的做法已有先例，但需在卸载时恢复，避免污染官方界面。

## 7. 预估

| 工作 | 量级 |
| --- | --- |
| 座位外壳（触发器 + 双栏浮层 + 悬停意图 + 键盘/搜索） | 1.5–2 人日 |
| 档位模型（定义、悬停二级页、选中映射） | 0.5–1 人日 |
| 模型详情面板（描述/倍率/思考强度/上下文展示） | 0.5–1 人日 |
| 自定义模型入口（复用 `CustomModelForm` 做弹窗，或跳转设置） | 0.5 人日 |
| 倍率/标签数据来源（后端或本地配置） | 0.5–2 人日（取决于是否已有接口） |
| 后端档位网关（方案 A） | 独立排期 |

## 8. 决策记录（2026-11-18）

| 问题 | 结论 |
| --- | --- |
| 是否授权占用 `conversation.input.model` | **已授权**；同步更新 README 与 AGENTS 的边界描述 |
| 档位落法 | 纯展示态（不改真实模型），后端网关 A 另行排期 |
| Auto 语义 | 一期只做展示效果；正式语义为「由网关按任务复杂度选档」 |
| 倍率 / 标签 / 上下文 / 繁忙数据源 | 本地映射 + 确定性兜底（`meta.ts`），接口化列为 P1 |
| `/model` 命令一致性 | 先记录，不接管 |
| 自定义模型入口 | 跳转「设置 → 模型管理」后自动打开添加弹窗（统一为设置内居中弹窗，新增/编辑共用） |

## 9. 验收与环境限制

- 已通过：`tsc --noEmit`；client bundle 构建（`dist/client.browser.js` 171206 字节）；preview profile 装载一致性校验（`cmp SAME`，`dsh.client.inject` 与 `react-dom` peer 均就位）；独立静态预览 + 13 张 Playwright 截图（打开态 / 档位详情 / 模型详情 / Auto / 自定义模型弹层）。
- **未做**：真实宿主 UI 验收。本机 `apps/web` preview 环境存在既有缺陷，页面 `Failed to load plugins`，无法进入正常 Composer：
  1. `install-preview.mjs` 安装列表不含 `packages/contracts`，profile 缺 `workdsh-contracts`，而 `asset-gate / connectors / model-market / projects / skills` 五个插件的运行时 `.js` 仍保留裸 `workdsh-contracts/*` import；
  2. `settings.launcher` 出现两处 `priority: 0` 注册冲突；
  3. `workdsh-plugin-quality-analysis` 激活失败导致 web boot 失败。
- 按用户决策，本阶段**以静态验收为准**，环境修复另行排期；详见 `backend-todos.md` 第四节。
