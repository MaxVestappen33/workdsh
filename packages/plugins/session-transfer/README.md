# 会话迁移插件（workdsh-plugin-session-transfer）

把设备 A 上的会话（对话日志、附件、被引用工作区文件）导出成一个可移植 ZIP，在设备 B 上导入后继续使用。

## 运行与交付基线

- **只面向本地安装的桌面客户端**：Windows `.exe`、信创 Linux `.deb`、macOS 包等，没有 Web 应用形态。
- 插件前端跑在 Electron renderer；`client.browser.js` + `window.__ModuleLoader__.load` 是客户端插件加载方式，不代表 Web 端。
- 平台中立：包内成员名一律 `/` 分隔的相对路径，Windows / Linux / macOS 之间可互导；默认工作区路径由 `process.platform + os.homedir()` 生成，不硬编码盘符、用户名或架构。
- **严格纯内置**：随 Desktop 构建链发行，V1 不以插件市场上架为目标。

### 交付形态决策：独立插件 vs 严格纯内置

需求讨论中曾考虑「独立插件、后期可上传到 DSH 插件市场」，最终用户拍板改为**严格纯内置**。两者不是互斥的技术方案（标准 Cordis 插件包两种分发方式都能承载），差别在装配与运维链路：

| 维度 | 独立 / 市场上架插件 | 严格纯内置（当前实现） |
| --- | --- | --- |
| 装配 | 走宿主的安装 / 启用 / 升级链路，需要市场元数据与版本协商 | 随 Desktop 构建链编译进发行包，无安装动作 |
| 门禁登记 | 不进产品构建链与发布白名单 | 必须登记 7 处：`apps/web/package.json` build/typecheck 链、`apps/web/docs/modules.json`、`profiles/shared/workdsh-features.json`、`workdsh-package-boundary.mjs`（3 张表）、`packaged-host-smoke.mjs` 服务映射、`verify-profile-release.test.mjs` 硬编码断言、`apps/web/pnpm-lock.yaml` importer |
| 版本关系 | 与宿主解耦，需自行处理 DSH 升级后的兼容 | 与客户端版本锁死，`pnpm-lock.yaml` 固定依赖；会话格式版本仍动态读 `catalog.currentVersion` |
| 私有服务 | 只能依赖宿主公开发布的服务 | 可直接使用本项目私有服务（`workdshIdentity` / `workdshAccess` / `workdshAudit`） |
| 代价 | 用户需手动安装、存在版本错配风险 | 不能单独更新，V1 无法上架市场 |

若后续要转为市场上架包，最小改动是补齐市场清单与安装/卸载入口、移除上述构建链与发布白名单登记，并把对私有服务的依赖改为宿主公开契约；核心 `src/` 导出/导入逻辑与 `client.tsx` 无需重写。

## 功能入口

| 入口 | 插槽 | 行为 |
| --- | --- | --- |
| 侧栏「会话迁移」（位于「资料库」下方） | `sidebar.panellist` → 主面板 `workdsh-session-transfer` | 主区域整页打开导出 / 导入（主入口） |
| 会话行右键「迁移会话」 | `sidebar.workspaces.session.menu.item` | 打开主面板并预选该会话 |

拖放导入只在本页面的拖放区生效，**不注册全局 window drop**。

导出列表与侧栏可见性一致：不显示空会话（创建后从未开始 turn）和子代理会话（随父会话自动级联导出），已归档会话仍显示并带标记；会话标题取自官方 `title` 投影，无投影时才以会话 id 兜底。

导入是直接落盘，不走官方「打开会话」的折叠链路，因此导入后的会话没有官方投影缓存；Host 在启动后会用官方冷读折叠 `sessionProjectionCache.coldSnapshot` 为这些缺口一次性回填标题（仅在标题投影单元已生效、且会话确实缺少缓存记录时执行），Client 随后刷新侧栏列表，所以重启后无需点开会话即可看到真实名称。

## 包格式（schema 2）

```
manifest.json
sessions/<safe-id>.jsonl              # 官方 readSessionLogText 输出的明文 JSONL
attachments/objects/<2>/<sha>         # image 对象
attachments/file-objects/<2>/<sha>    # file 对象
workspace/<workspaceId>/<rel/path>    # 口径 A：仅被会话引用、位于工作区根内的相对路径文件
```

`manifest.json` 关键字段：

- `kind = 'workdsh-session-transfer'`，`schema = 2`
- `format.sessionVersion`：导出机 `sessionFormatCatalog.currentVersion`，是 `createRestore` / `readHeader` 的输入与交叉校验值
- `client.platform`：仅记录来源平台，**导入端不得据此拒绝包或做平台分支**
- `workspaces[]` / `sessions[]` / `attachments[]`（保留完整 `AttachmentRefV2`）/ `missingAttachments[]`
- `workspaceFiles`：`included`、`policy: 'referenced-relative-only'`、`excludes`（内置基线 + 用户追加）、`files[]`（相对路径 + sha256 + bytes）、`skipped[]`、`totals`
- `archivePolicy`：`preserve` | `none`

## HTTP API

统一前缀 `/api/session.transfer.*`，全部要求已登录（`workdshIdentity.resolve`）。

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `export.preview` | POST | `sessionIds` 为空 → 轻量列举会话（选择页）；非空 → 统计选中内容（预览页） |
| `export` | POST | 返回 ZIP 流；响应头 `x-transfer-job-id` 供进度轮询 |
| `export.status` | GET | `?jobId=` → `JobStatus` |
| `import.preview` | POST | **streaming** 上传 ZIP 字节流（绕开 buffered 的 300 MiB 上限），解包校验后返回 `token` |
| `import.apply` | POST | 立即返回 `batchId`，后台执行批次 |
| `import.status` | GET | `?batchId=` → `JobStatus` |
| `import.cancel` | POST | `{ batchId }` → 中止并触发全批次回滚 |

## 关键实现契约（三条红线）

1. **禁止硬编码版本号 `4`**：所有版本判断走 `sessionFormatCatalog.currentVersion` / `readHeader` / `createRestore`。包版本高于本机 → **整包拒绝并提示升级客户端**；低于本机 → 复用官方相邻迁移链升级导入。
2. **禁止全局替换事件文本里的路径字符串**：只改结构化字段——header `cwd`、`working-directory/change.data.cwd`、`deliverables/presented.data.files[].path`、`tool/result.data.meta` 的 `cwd`/`path`/`diffs[].path`、结构化 id 引用（`sessionId` / `parentSession` / `targetSessionId`）。原因是 `workspace.attachSession(id)` 校验 `header.cwd === workspace.path`；产物卡片与工具元数据里的绝对路径若不改写，导入端预览会指向导出机路径并提示「文件不存在」。`diffs[].oldText/newText`、消息正文等文本内容一律不改。
3. **禁止用只读的 `dsh-api-workspace-files` 做迁移**：导出走本机文件系统 + 官方 `readSessionLogText`，导入走 sha256 校验后的落盘。

其它要点：

- 导出前 `flushLiveSessionLog` + `persistence.flush()`，否则最后几条事件不在包里。
- 附件收集自研（官方收集函数未导出），覆盖 `user/message`、`assistant/message`、`tool/result`、`carrier.stream` 的 `block-end` 等。
- 导入侧附件按官方 `dsh-attachment-local` 内容寻址布局回写：`DSH_HOME/attachments/v1/{objects,file-objects}/<2>/<sha>`，file 类型补 `files/<2>/<sha>/<name>` 别名；写前校验 sha256 与 id 一致，已存在则复用不覆盖。
- 冲突策略：不做覆盖。勾选 = 导入为新会话；本地已有同 ID 时生成新 ID，整组重映射父子引用，`session/title` 追加「（导入）」。
- 事务语义：单会话失败隔离；**取消 = 回滚全部**（会话目录、附件、工作区文件、新建目录、注册工作区）。`runBatch` 在「附件回写 / 工作区文件 / 归档 / 绑定 / 写审计」每个阶段边界都调用 `signal.throwIfAborted()`，`bindAll` 循环内同样检查，保证进度条任意时刻点「取消」都能触发回滚，而不是让批次继续跑到 `done`；已写入的附件与源文件登记在 `batch.writtenFiles`，由 `rollback()` 逐个删除。`bindSession` 放在批次末统一执行（P18），避免取消时产生 owner 脏数据。
- 归档策略在导入 Step 2 由用户选择：`preserve` 调 `archiveSession`，`none` 全部未归档；置顶与侧栏排序不迁移。
- ZIP 流式：打包复用 `fflate` 的 `Zip + ZipDeflate + desiredSize` 背压；解包用 `Unzip` 分块 push + 同步写 fd。注意 **fflate 的 `Unzip` 必须在 `onfile` 里调用 `file.start()`**，否则 `ondata` 不触发。含 zip-slip 防护、压缩方式白名单（0/8）、解压后总字节上限。
- 项目只有账号模型，必须登录；不做跨账号检测。

## 相对实现规格的扩展

| 扩展 | 原因 |
| --- | --- |
| `export.preview` 空 `sessionIds` 走轻量列举 | 选择页需要全部会话清单，但不能触发 flush / 读全部日志 |
| `ImportPreview.localWorkspaces` | Step 2 需要「导入到已有工作区」的下拉选项 |
| 未匹配工作区给出 `defaultWorkspaceRoot` 建议路径 | 新建目录输入框需要平台中立的默认值 |
| `ResultRow` 增加 `attachmentsRestored/attachmentsSkipped` | 结果页报告附件还原统计 |
| 附件回写实现 | 包内附件必须落回本机对象存储，否则导入后附件不可读 |

## 与 IMPLEMENTATION.md 规格的核查结论（真实代码对照）

需求阶段的实现规格基于调研写成，落地前逐条对照了仓库真实代码与官方 SDK，修正如下：

| 规格假设 | 真实代码结论 | 实现处理 |
| --- | --- | --- |
| 官方 `/export` 包可双向兼容 | 官方包是单会话 ZIP、无 manifest、只导出不导入 | 只做自建 schema 2 包，官方包仅做格式对齐，不承诺兼容 |
| 新版本包可「降级导入 + 报告损失」 | `readHeader` 对 `storedVersion > currentVersion` 返回 `unsupported`，`createRestore` 会抛异常 | 按用户拍板改为**整包拒绝并提示升级**；低版本走官方相邻迁移链 |
| v4 可硬编码 | `SESSION_FORMAT_VERSION = 4` 来自 `@deepseek-ai/dsh-session`，会随官方升级 | 全部走 `catalog.currentVersion`，禁止硬编码 4 |
| `working-directory/change` 可不处理 | `workspace.attachSession(id)` 校验 `header.cwd === workspace.path` | 改写 header `cwd` 与所有 `working-directory/change.data.cwd`，且只改结构化字段 |
| `dsh-api-workspace-files` 可用于迁移 | 该服务是只读视图 | 导出走本机 FS + 官方 `readSessionLogText`，导入走 sha256 校验落盘 |
| 附件可用 `saveImage/saveFileStream` 回写 | 这些方法会重新归一化字节、可能改变 sha，与事件里的 `sha256:<hex>` 引用不匹配 | 新增 `attachments.ts` 按官方内容寻址布局直接回写（已核对 `dsh-attachment-local` 的 `normalizedImagePath` / `storedFileObjectPath` / `storedFilePath`） |
| 内置插件只需放进目录即可 | 必须登记构建链与发布白名单，且有硬编码门禁测试 | 已登记 6 处门禁文件并同步更新 2 处硬编码断言 |
| 侧栏主面板入口可用 | 已在 `@deepseek-ai/dsh-client-ui-sidebar` 的 `slots.d.ts` 中确认 `sidebar.panellist`（行 id 即主面板 id）与 `main` 插槽存在 | 入口注册为 `sidebar.panellist`（`order: 55`，位于资料库 `order: 50` 下方），主面板注册在 `main` 的 `workdsh-session-transfer` 键下；组件参数用 `as never` 规避声明合并耦合 |
| streaming 上传 | `buffered` 有 300 MiB 默认上限 | `import.preview` 用 `requestBody: 'streaming'` |
| 前端下载方式 | 桌面 renderer 无 Web 应用形态 | `fetch + blob + a[download]`（`Blob + URL.createObjectURL` 不等价于 Web 端） |

所有需求阶段待拍板项（P1–P19）已由用户在会话中逐项定稿，实现过程中未再引入需要用户决策的新分叉。

## 已知风险 / 待办

- `JobStore` 是内存态：Desktop 单进程重启后 preview token / batchId 丢失（可接受，重新选择文件即可）。
- 回滚删除会话时按 `context.home/sessions/<project>/<id>` 目录清理（与 session-recycle 一致；路径取本次请求的 home，不读全局环境变量，避免回滚落到错误目录）；若官方持久化布局变化，需要同步调整。
- 导出下载在 renderer 里用 `fetch + blob + a[download]` 触发，整包会进入 renderer 内存；受 `LIMITS.maxArchiveBytes` 约束。
- 工作区文件口径 A 只带被引用且位于工作区内的相对路径文件；绝对路径引用仍只能看、不能继续操作。
- 三层验收均已完成：逻辑层 `tests/import-apply.test.mjs`、HTTP 路由层 `tests/routes.test.mjs`、**浏览器真实点击层** `tests/browser/click-e2e.mjs`；**尚未做**打包后 Windows `.exe` / 信创 Linux `.deb` 安装副本的真机 GUI 验收（需要宿主运行时与真实登录态），这是唯一剩余缺口。

## 构建与验证

```bash
# 在 apps/web 目录（pnpm workspace 根）
corepack pnpm --filter workdsh-plugin-session-transfer typecheck
corepack pnpm --filter workdsh-plugin-session-transfer build
node --test packages/plugins/session-transfer/tests/*.test.mjs
```

测试分层：

- `paths / manifest / roundtrip / export-import`：纯逻辑、ZIP 往返、导出包自洽
- `import-apply.test.mjs`：真实 `exportArchive()` → `importPreview()` → `importApply()` 完整批次，覆盖结构化 cwd 改写、事件文本不被改写、附件/源文件还原、归属绑定与审计、冲突重映射、取消回滚
- `routes.test.mjs`：**直接调用 `apply()` 注册的 7 个 HTTP 路由**（真实 `Request`/`Response`），并使用真实官方 `@deepseek-ai/dsh-session-format-catalog`（v4）与 `@deepseek-ai/dsh-session-log-export`（其余测试注入的是 mock），跑通 export → import.preview → import.apply → status 全链路，另覆盖 405 / 401 / 400 / 404 / 参数窄化 / effect 反注册

真实官方 v4 事件必须带 `seq`（从 0 连续）与 `time`，否则 `createRestore` 会拒绝 —— 这是 mock 测试掩盖不到、由 `routes.test.mjs` 暴露并纳入测试基线的契约。

### 真实点击验收（`tests/browser/`）

`tests/browser/click-e2e.mjs` 把前端 UI 真正跑起来点一遍，**不在默认 `node --test` 套件内**（需要浏览器，手动触发）：

```bash
corepack pnpm --filter workdsh-plugin-session-transfer build   # 先产出 dist/client.browser.js
corepack pnpm --filter workdsh-plugin-session-transfer test:click
```

做法与边界：

- 浏览器加载的是**真实前端产物** `dist/client.browser.js`，跑在真实 React 19 上；宿主只 stub 了框架提供的 `slots` 容器与 `MenuButton` primitives，UI 代码零改写。
- 后端是 `apply()` 注册的**真实 7 个 HTTP 路由** + 官方 v4 解码链，由本地 HTTP 服务承载（`Request`/`Response` 真实往返）。
- 点击是 Playwright 真实鼠标事件；导出会触发浏览器**真实下载**，下载的 ZIP 直接作为导入输入，形成「导出→导入」闭环。
- 覆盖：侧栏入口 + 会话右键入口 → 主面板整页 → 分组展开/收起与分组全选 → 按工作区勾选「携带工作区文件」 → 预览 → 真实下载 ZIP → 导入预览（版本裁决 / 工作区匹配 / 未归属工作区映射 / 冲突标识 / 归档策略）→ 真实导入 → 结果报告，并断言后端真实写入 `bindSession` / 审计 / 新会话 / `attachSession`，且无页面异常与 `console.error`。
- 截图输出到仓库 `.artifacts/session-transfer-click/`。
- 浏览器优先用系统 Chrome（`channel: 'chrome'`），无 Chrome 时回退 Playwright 自带 chromium（需先 `npx playwright install chromium`）。

这一层抓到了纯逻辑与 HTTP 测试都发现不了的真实缺陷：**导入到结果页时步骤条仍停在「3 导入中」，「4 结果报告」不点亮**（`Steps` 用 `index <= current` 高亮，而 `current` 未区分 `result` 态），已修。

### 开发环境人工验收清单

`ACCEPTANCE-CHECKLIST.html` 是单文件离线勾选清单（6 组 35 项），供装机前在 `corepack yarn dev` 启动的桌面客户端里手工点一遍：启动/登录 → 准备测试数据 → 导出三步 → 导入四步 → 5 项重点回归（附件打开、工作区文件可用、ID 冲突、取消回滚、新版包整包拒绝）→ 出错定位。整行可点、分组小计、总进度条、勾选状态存 `localStorage`、支持深浅主题与打印；浏览器直接打开即可，与自动化截图 `01~09` 可逐页对照。

最近一次全量验证（2026-11-26，导入后标题/侧栏可见性修复 + 启动回填标题投影）：typecheck 通过；插件测试 **26/26**；真实点击验收 EXIT=0（导出 → 真实下载 ZIP → 导入 → 结果报告 → 右键预选闭环）；`dist/index.js` 与 `dist/client.browser.js` 构建通过。真机（Desktop 开发模式）重启后检查 `session_projcache`：50 个导入会话全部生成身份匹配的缓存记录，其中 48 个带标题、2 个无用户消息（官方同样无标题）。

构建产物：

- `dist/index.js`：Host 侧入口（`exports "."`）
- `dist/client.browser.js`：Client Loader 模块（`exports "./client"`）
- `cordis.patch.yml`：Loader 注册条目

已登记到：`apps/web/package.json`（build/typecheck 链）、`apps/web/docs/modules.json`、
`profiles/shared/workdsh-features.json`、`apps/desktop/scripts/workdsh-package-boundary.mjs`
（`PRODUCT_PACKAGES` / `RELEASE_PACKAGES` / `PACKAGE_DIRECTORIES`）、
`apps/desktop/scripts/packaged-host-smoke.mjs`（`PRODUCT_SERVICES`）。
