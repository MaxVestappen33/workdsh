# 任务清单

> 规格见 `spec.md`。Phase 0 通过后才进入 Phase 1；Phase 3 需单独授权。

## Phase 0 · 探针验证（只读 + 一次性临时插件）

- [ ] T0.1 临时注册占位组件到 `conversation.hero.brand.mark`，确认首屏（`sessionId === void 0`）下该槽是否渲染
- [ ] T0.2 确认 `priority: -10` 确实压过官方 occupant（侧栏 mark/name 各验一次）
- [ ] T0.3 确认卸载/禁用后官方 fallback 立即回归，无残留 DOM
- [ ] T0.4 确认侧栏折叠态与展开态共用同一槽，一次注册覆盖两态
- [ ] T0.5 把三条结论与证据写入 `specs/brand-plugin/probe.md`
- [ ] T0.6 若 T0.1 为否：调整 Phase 2 承载点方案并更新 `spec.md`

## Phase 1 · 骨架 + 需求一

### 包骨架

- [ ] T1.1 建 `packages/plugins/brand`，`package.json` 对齐 `model-market` 形态（`dsh.bundle.patch` + `dsh.client.inject` + `immediately`）
- [ ] T1.2 `cordis.patch.yml`：`- insert: [{id: workdsh-brand, name: workdsh-plugin-brand}]`
- [ ] T1.3 `tsconfig.json` / `tsconfig.client.json` / `tsconfig.client.build.json` 三件套
- [ ] T1.4 `apps/web/scripts/build-brand.mjs`（参照 `build-model-market.mjs` 的 `__ModuleLoader__` 包裹）
- [ ] T1.5 登记 `apps/web/package.json`：`build`、`typecheck` 链，新增 `test:brand`
- [ ] T1.6 登记 `packages/bundle/cordis.patch.yml` 的 insert 列表
- [ ] T1.7 空跑 `pnpm --filter workdsh-plugin-brand build` + `typecheck` 通过

### Host 半

- [ ] T1.8 `src/shared.ts`：zod 配置 schema、默认值、显隐与 resource 上限（256 KB）
- [ ] T1.9 `src/service.ts`：Storage Domain 读写，按账号隔离
- [ ] T1.10 `src/connection-api.ts`：Client→Host 的 get/set/reset/upload 四个 RPC
- [ ] T1.11 `tests/config.test.mjs`：schema 校验、超限拒绝、非法值拒绝、按账号隔离

### Client 半

- [ ] T1.12 `apply()` 注册四槽：`sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.toggle.badge`、`conversation.hero.brand.mark`，全部 `priority: -10`
- [ ] T1.13 `SidebarBrand.tsx`：mark / wordmark（text 与 svg 两种模式）/ badge，折叠与展开两态自适应
- [ ] T1.14 `HeroMark.tsx`：独立配置、`size` 与 `className` 可忽略、自带 `prefers-reduced-motion` 尊重
- [ ] T1.15 全部注册走 `ctx.slots.inject`，卸载时 `ctx.effect` 清理（无定时器、无全局监听残留）
- [ ] T1.16 `styles.ts`：只用 `--dsw-alias-*` 与 `packages/ui` 的 `tokens`，无硬编码色值
- [ ] T1.17 `tests/registration.test.mjs`：注册优先级、卸载清理、`visible:false` 时回落到官方

### 设置面板

- [ ] T1.18 `panel.tsx` 注册 `settings.section`（带 `order`），一个面板管两个区域
- [ ] T1.19 面板能力：实时预览、上传/内联 SVG、字号/字重/字距/颜色、显隐开关、一键重置
- [ ] T1.20 面板与槽的联动：改配置即时生效，无需重启

## Phase 2 · 需求二（纯槽）

- [ ] T2.1 `conversation.input.dock` 注册 tab 行（条目可配置）
- [ ] T2.2 `conversation.input.dock` 注册 chips 行（点击行为：回填输入框 / 直接发送）
- [ ] T2.3 `shell.overlay` 注册吉祥物浮层（可关闭、`pointer-events:none`、随窗口尺寸自适应）
- [ ] T2.4 面板扩展：内容条目增删改与排序
- [ ] T2.5 清理：所有新增监听与 rAF 在 `ctx.effect` 返回函数中释放
- [ ] T2.6 记录已知边界（位置被钉在官方标题与工作区行之下）到 README

## Phase 3 · 整屏 hero（需授权）

- [ ] T3.1 `scripts/native-workbench-frame-patch.json` 新增一处 replacement：`HeroShell` 内插入 `renderSlot('workdsh.conversation.hero', {t, renderSlot}, {fallback: 官方 stack})`
- [ ] T3.2 同步 `scripts/` 与 `apps/web/scripts/` 两份入口（共用 adapter），重算 `originalSha256` / `patchedSha256`
- [ ] T3.3 preflight 增加"未知字节 fail closed"用例
- [ ] T3.4 Desktop `afterPack` 用 `verifyNativeWorkbenchFrame` 校验真实 Resources
- [ ] T3.5 `--rollback` 验证：回滚后官方 hero 完整恢复
- [ ] T3.6 Hero 组件改挂新槽，完成大标题 + tab + chips + 吉祥物一体化排版（D7 双轨保留旧挂点作降级）
- [ ] T3.7 标题文案与排版自主（含徽标），不再依赖 `.pXSMma_*`
- [ ] T3.8 真机验收：浅色 / 深色 / 窄窗 / 折叠侧栏 / 首屏 ↔ 会话中切换

## Phase 4 · 收尾

- [ ] T4.1 README：安装、配置、卸载、与 brand-studio / hero-custom 的互斥说明
- [ ] T4.2 CI 断言：产物中不得出现 `pXSMma` / `_headlineText` 等哈希类名选择器
- [ ] T4.3 `yarn check` 全绿（layout / alignment / 双语 / 各包 typecheck + test）
- [ ] T4.4 卸载与回滚演练各一次，记录到 `spec.md` 附录
- [ ] T4.5 DSH 升级锚点说明（槽名断言位置、升级后必查项）写入附录
