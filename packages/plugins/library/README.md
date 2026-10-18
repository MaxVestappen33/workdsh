# 资料库

状态：**实施中**。Alpha.1 已建立本地资料领域服务、WorkBuddy 式目录树与原内容工作区、对话固定修订引用和 Markdown/TXT 草稿发布流程。

- 实现阶段：P1
- 主任务：P1-06，详见 [需求与范围](../../../apps/web/docs/REQUIREMENTS.md)
- 职责：本地资产与修订、目录树、确定性文本转换与检索、工具读写、成果关联；团队提供方可替换。
- 边界：不复制 Harness 会话日志，HTML 不获 Host 权限。

## 开发前阅读

[规则](../../../apps/web/AGENTS.md)、[验收要求](../../../apps/web/docs/ACCEPTANCE.md)、[契约](../../../apps/web/docs/CONTRACTS.md)、[团队设计](../../../apps/web/docs/CONTRACTS.md)。

所有业务操作遵守服务端主体和组织上下文；页面与 Agent 工具调用相同领域服务。可选功能接入通过公开契约与生命周期注入。

对话右侧资料引用预览使用 Harness 官方语义颜色，跟随浅色、深色和系统主题；HTML 原件在沙箱中保留自己的页面样式。

## 验收与下一步

完成对应 PLAN 任务及 [验收矩阵](../../../apps/web/docs/ACCEPTANCE.md) 场景，记录真实测试证据后才更新为完成。当前 Host 与 Client 入口可加载，数据保存到 `$DSH_HOME/library`。支持 MD、TXT、HTML、PDF、DOCX、PPTX、CSV、XLSX；所有格式保留原件并生成独立检索文本。HTML 在无 Host 权限、无网络访问的沙箱中按原始样式和内联交互展示；PDF 可直接预览；安装 Office 插件时，Word 使用 `docx-preview`、PowerPoint 使用 `pptx-react-viewer` 打开原件，未安装时回退为派生检索文本和原件下载。Library 与 Office 通过公开可选预览注册表协作，不互相导入运行时内部实现。

发布包可通过 `corepack pnpm probe:library` 验证独立安装、两次冷启动、卸载保留 `$DSH_HOME/library`、重新安装和资料恢复。页面支持搜索、最近、本地产物、完整目录树、目录内新建与导入、移动、添加到当前任务、停用与重新启用；停用会立即阻断历史任务引用的正文读取。搜索结果显示目录、类型、来源、修订、转换状态和页/段/幻灯片位置。

单文件上限为 50 MiB，本地不可变原件修订合计上限为 5 GiB。转换器意外失败时保留原件并标记“转换失败/不可搜索”；伪类型、损坏文件、压缩炸弹、路径逃逸和取消不会创建资产。

## 修订 6 的必做补充

详见 [项目设计](../../../apps/web/docs/ARCHITECTURE.md) 和 [官方依据](../../../apps/web/docs/CONTRACTS.md)。新增目录仍为规划占位；各自实现 PLAN 的 P1 补充项并验证 J01—J10 适用项。

实现前必须阅读 [ADR-0007](../../../apps/web/docs/CONTRACTS.md)，完成相应 B/Q 边界用例；不可只用提示词或 UI 达成权限保障。

页面及配置弹窗随 Harness 原生主题变化；文件类型图标与文档原文保留自身颜色。

共享 Host 可以使用 `registerLibraryConnection(ctx, selector)` 的可选可信服务选择器：返回服务端建立的 actor、LibraryService 与 verify，路由执行前后核验，客户端 payload 不能选择成员。个人默认调用不传 selector。成员实例需要独立对象目录及存储 facility/backend；同一官方 facility 不允许重复 open 同名 domain，仅 isolate LibraryManager 不足以隔离。此入口只负责 HTTP 管理，Agent 工具和资料上下文仍需匹配成员服务后才能开放完整企业 Profile。

### 可选 Host 成员服务选择

公开 registerLibraryConnection、registerLibraryTools、registerLibraryContextInjection 接受可选可信选择器，返回服务端 actor、LibraryService 和 verify。工具与上下文使用实际 Agent 选择，不从模型参数读取主体；操作前后核验，拒绝不匹配的会话上下文。默认 apply 不传选择器，保持个人行为。企业装配必须提供隔离存储和可撤权身份；这些入口本身不是文件执行沙箱。

## 表格资料

CSV/XLSX 可上传、按类型检索并引用到任务；原始文件按字节保留。Host 转换在构建时复用共享 `workdsh-tabular` 的 CSV 解码/解析；表格提取模块与 PapaParse 随 Library 构建，运行时复用 ExcelJS，无需安装或激活 Office 插件即可导入和检索。CSV 支持 UTF-8、GB18030、UTF-16，以及逗号、分号和制表符；XLSX 提取工作表名称和单元格已有值，公式不重新计算，图表、图片和格式不进入检索文本。检索文本最多 1500 行/120 列/24000 单元格，XLSX 最多 20 个工作表；截取会显示警告，完整原件仍可下载。

原件预览通过公开可选注册表复用 Office：CSV 为只读表格，XLSX 使用现有隔离编辑器；普通预览导出副本，提供公开保存回调的业务工作台可明确保存为新修订，不覆盖旧原件。未启用 Office 预览时显示检索文本。个人与企业 Desktop、Web 复用相同导入和预览实现，实际资料授权保持不变。

## 公开资料选择组件

客户端公开入口 `workdsh-plugin-library/client` 导出 `LibraryAssetPicker`、`LibraryAssetPickerProps`、`createLibraryClient` 与 `LibraryClient`。工作台可复用目录浏览和资料管理入口，无需创建对话或伪造sessionId。组件接收 `management.list`、`openLibrary` 和同步 `onSelect(entry)`；返回true关闭选择面板，返回false保留面板并提示重试。调用方保留选中资产及精确修订ID，再通过Host领域服务读取原件；选择组件不授予读取权限。通用组件不响应对话输入框的资料选择事件，原 `LibraryPicker` 继续承担对话引用插入。客户端的lifetime信号由所在插件拥有，卸载时取消。


### 工作台编辑原件并保存新修订

公开 `createLibraryOriginalPanelClient(ctx).open({assetId,revisionId,name,kind,returnPanel?:{id,label}},signal?)` 将固定修订打开在官方会话右侧资料 Tab。官方当前版本的右侧栏属于真实 Session，全局工作台页面不能与它并列；入口先返回已选会话，没有会话时通过官方 Workspace owner 复用或创建真实会话，再打开右侧文件。右侧文件可提供“返回工作台”，仅跳转仍注册的 main 页面。Tab 参数仅携带 JSON 引用与返回位置，不传回调、凭据或业务正文。

右侧文件沿用唯一 Library/Office 预览注册表。CSV 只读；XLSX 的显式保存通过 Library 的 `saveOriginalRevision` 校验固定基准修订、操作幂等及字节摘要，新版本待工作台回读并明确采用。保存中阻止官方 Tab 关闭和返回按钮，已访问正文保持挂载以保留切 Tab 时的编辑状态；插件卸载与导航更新取消旧请求，取消/通信失败须核对资料库保存结果，不能宣称未保存或重试为另一份文件。

工作台从公开 Library Client 读取 `readOriginal(assetId, revisionId, signal)`，将固定版本的字节交给 `workdshLibraryPreview.mount`。`LibraryOriginalPreviewInput.onSaveOriginal(bytes, signal)` 是可选能力：目前系统 Office 的 XLSX 编辑器支持它，CSV、DOCX 与 PPTX 不因此获得保存能力。未提供回调时 XLSX 仍导出副本。工作台应检查预览注册表 `canOpen`，保持缺少 Office 时的资料库入口。

回调调用公开 Client `saveOriginalRevision({assetId, expectedRevisionId, operationId, bytes}, signal)`，返回 `LibraryTreeEntry`。Host 在当前身份与权限下保存不可变原件、转换结果和新修订；不接受客户端 token 或外部 URL。当前 Host 上原资产已有更新时拒绝旧基础保存。同一操作编号和同一输入可重试得到原保存回执，输入改变则不能复用操作编号。回执可能指向已经不是最新的历史修订，不要用资产当前版本字段替代回执里的 `revision.id`。

保存回调只提出新的来源。工作台显示“采用新版本”，经用户选择再使用新 `revision.id` 导入和分析，保留旧快照、运行和报告。关闭预览或身份变化需取消请求；如果提交结果未知，核对资料库或用原操作编号重试，不能把网络错误当作未保存。通用原件保存限额为 50MiB，目前 Office XLSX 编辑保存限额为 10MiB，仍受编辑器对不支持工作簿对象的导出检查约束。

质量分析插件已有此接线，并在实际安装的官方 Profile 中验证新 XLSX 修订重新分析及历史保留；Office 浏览器按钮和实际页面交互尚未完成 GUI 验收。上述单 Host 串行版本检查不构成多 Host 存储事务保证。
