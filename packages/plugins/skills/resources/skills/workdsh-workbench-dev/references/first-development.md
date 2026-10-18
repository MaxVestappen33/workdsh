# 首次开发

1. 根据本轮需求确定业务对象、状态、用户动作、AI 分工和成果落点，保存需求与验收样例。保留用户选定的整页或左右分栏布局；仍在产品讨论阶段时不提前生成或安装候选。
2. 从真实开发入口进入官方 Creator（`cordis`），先加载 `cordis-plugin-development`，再加载本 Skill。调用 `workbench_read_development_context` 取得本会话实际关联的已保存需求、源码、插件身份与安装目标，核对原生会话绑定的工作目录，保留已有草稿；权限、发送和工具执行使用官方能力，不能自称已经关联或开始执行。
3. 优先使用开发上下文内联的 SDK 最短示例、版本和现有模板，直接开始本轮业务实现；只核对本轮新增接口，不重复查已确认的注册与构建方式。真实错误或版本变化时再查对应公开契约。使用官方公开模板或已交付 WorkDSH 模板在工作目录开发，不引用机器上的产品源码或绝对 node_modules 路径。保持稳定包名和工作台 ID，静态声明与运行注册一致，清理由插件生命周期管理。
4. 先完成一轮能实际操作的业务流程。AI 协作另外验收：绑定当前对象与完整输入版本 → 原生会话执行真实业务工具 → 候选回到对应对象 → 页面读取展示 → 用户继续加工或采用。切换对象后旧结果不能误写；示例数据明确标注，真实来源未验收不能声称联调完成。仅生成 Agent preset 或配置 bundle，不等于交付了业务 Client UI。
5. 通过上下文 `sdk.delivery.runner` 或骨架 `node deliver.mjs` 统一构建、启动检查、打包并记录阶段耗时；不逐个编写检查脚本、不重复手动 build/pack。按 [启动检查](startup-validation.md) 核对产物的真实工具定义与完整插件生命周期，保留具体失败原因；构建成功不能代替启动通过。在用户授权的阶段，依照官方 Skill 与实际模板检查、构建，重新读取开发上下文核对真实候选版本及 tgz 内容摘要。包存在不证明构建来源与当前源码一致。用原生 `plugin_manager` 的 `install_bundle` 安装实际候选，target 为经核实的 tgz 绝对路径、`enabled:false`，读取 `application`、`warnings`。随后以候选的 version、sha256 调用 `workbench_verify_native_installation`，由宿主检查本会话归属、实际安装字节和平台登记。该工具不重新安装、不启用、不重启；回执丢失时先核对已安装结果，不重复执行安装。不具备工具或校验失败时保留实际结果和具体未完成项。
6. 核验回执 `activationVerified:false` 表示“未核验启用”，不是启用失败，不重复安装。已有启用/试用授权时，按回执 `plugin_manager list_bundles` 找到实际包名（需要时沿 nextOffset 分页），核对版本和 error，再 `set_bundle`（target 为包名、enabled:true）；不猜 entryId、include: 前缀或用 set_plugin 代替。未获授权时由用户从工作台列表启用并打开。读取 application、warnings、nextStep；需要重启时说明原因及当前活动版本，不自行重启无关任务。在当前已认证的宿主应用页面核对 Host/Client、逐项操作本轮业务并重开检查数据：Desktop 用正在运行的 WebView，Web 用当前已登录应用页面。独立任务浏览器不自动共享宿主登录态，401 时停止该路径，不查找/读取/复制 token、cookie 或凭据绕过。未能操作已认证宿主页面时明确保留“页面未验收”。通过后保存已验收版本，其余需求保持待办。

## 开发指令需要携带的上下文

指令引用官方 `cordis-plugin-development` 与本 Skill，不重复官方开发和安装流程。业务上下文从已保存需求及实际宿主读取：开发记录与需求修订、完整需求和验收样例、稳定工作台 ID 与包名、源码目录与修订、目标 Profile/安装实例、已知 SDK/模板版本及恢复文档。运行时版本和可用接口由官方检查工具核实；未取得业务 SDK 时保留需求和源码，不虚构可执行接口。

保留用户的布局和本轮范围。Excel、CSV 与报告文件使用系统 Office 的公开能力；字段对应、核对、统计属于业务页面。分析绑定完整已授权输入的固定版本，AI 输出绑定业务对象并供用户采用，不能只把结果留在聊天中。

每轮报告源码改动、实际检查结果、候选身份、官方安装与平台登记结果、逐项业务验收及未完成项。代码、包、安装、登记和可用页面是不同事实；恢复上下文来自持久记录，不用聊天中的完成声明代替。

核对 WorkDSH 扩展接口时遵循 [SDK 核验](sdk-verification.md)。不要把官方静态目录查询失败当成宿主缺服务，或把 Config 的 `absent` 当成未安装。

## 固定工具链，先检查再安装

- 新骨架的 `.npmrc` 将 pnpm store 放在项目内，避免用户全局缓存的旧权限影响构建。通过官方工作区依赖工具取得当前 Node 与 pnpm JavaScript 入口，用 `<node> <pnpm入口> install` 安装开发依赖，交付直接运行 `node deliver.mjs`；不要要求 sudo，不修改用户全局缓存权限，也不要用系统 tar 手工拼包。macOS tar 可能混入 AppleDouble 文件及扩展头，原生安装接受不代表平台归档校验通过。
- 客户端导入 `workdsh-plugin-workbenches/client` 时保持为 external，由宿主提供同一份 SDK，不能重复打包平台和 React。骨架 build.mjs 已包含这项设置。
- 安装前再调用 `workbench_read_development_context`，必须在 `candidates` 找到同版本、同 SHA256 且 `compatible:true` 的候选。候选的 `errorCode` 要先修复，不能跳过包检查直接安装。哈希来自同一份最终 tgz，重打包后重新读取，不使用旧哈希。
- 安装等待授权是独立状态。清楚告诉用户“等待安装授权”，不将此时间描述为代码生成或持续思考。
