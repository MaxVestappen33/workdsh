# WorkDSH SDK 核验

## 区分目录、安装和运行

官方 `cordis_inspect_query` 的 `Service.listService` 查询官方预生成的接口目录，并非任意第三方插件动态提供服务的全量清单。`workdshWorkbenchRegistration` 和 `workdshWorkbenchClientRegistration` 是 WorkDSH 扩展服务；返回 `no catalogued Service named ...` 只说明该目录没有收录，不能断言服务未运行，也不能反向当成服务可用的证明。这两个接口已知不在该目录内，不调用 `Service.listService` 查询它们，也不切换 Host/Client 重试。

官方 `Config.listConfigs` 的状态描述配置 Schema：`absent` 表示插件运行模块没有声明 Config，`schema` 表示可读取配置结构，`unsupported` 表示配置结构不能按该协议投影；`inactive` 表示条目禁用或没有活动 fiber。`absent` 不表示未安装。Client 查询超时也不单独证明服务不存在，应结合输出中的实际错误和活动状态核对。

## 正确的核验顺序

1. 调用 `workbench_read_development_context`，核对本会话关联的需求、源码、插件身份和安装目标；它成功只证明该工具链可用，不证明全部业务接口都可用。
2. 开发上下文的 `sdk.status=available` 时，优先使用其中已内联的 `quickstart` 与现有骨架；只在本轮确需额外接口时按 `readme`、`publicTypes.host/client` 读取对应公开契约，版本取 `sdk.version`；不再额外搜索安装目录或查询该 SDK 的 Service/Config 目录。只有 `sdk.status=unavailable` 或旧宿主未提供该字段时，才用 `Config.listConfigs` 查询插件名 `workdsh-plugin-workbenches`，再以实际条目 id 查询详情取得 `packageDir`。官方 Host/Client API、Slots 和生命周期仍按官方 Skill 核对本轮用到的接口。
3. 只读实际解析包的 `package.json`、README 和 exports 指向的公开类型，确认已交付版本、Host/Client 注册签名、注入声明和生命周期。通过实际解析路径读取文档是允许的；不得把机器绝对路径硬编码进插件、复制产品私有源码，或将开发仓库当成目标宿主已安装版本。
4. 区分可继续实施和可证明已运行：公开 SDK 已核对时可在关联源码中开发；交付前用官方 Cordis 生命周期在隔离存储中验证 Host 注入、注册、业务服务与释放。安装后核对真实字节、启用选择、Host/Client 注册和实际页面。静态目录、README、候选包和成功安装都不能替代运行验收。
5. 若无法取得已解析包、公开签名不匹配，或真实加载、注册、路由调用出现失败，保留源码及具体错误，报告缺失证据；不能仅凭未收录目录或无 Config 阻断开发，也不能忽略真实运行异常。不要据此擅自安装、重装、停用 SDK、修改官方工具或更换插件身份。

## 本次典型误判

- 错误：Service 目录里没有 WorkDSH 注册服务 → SDK 没安装。
- 正确：目录未收录 → 继续读取实际 SDK 的公开文档与类型，并通过实际加载验收确认。
- 错误：Config 状态 absent → 插件未启用。
- 正确：没有 Config Schema → 另行核对活动状态和实际注册结果。

## 限定核验范围

普通业务包先读 SDK README 的“业务包最短接入”，沿用生成骨架的注册和构建代码。页面参数直接使用公开 `WorkbenchPageProps`，按钮直接使用公开 `WorkbenchButton`。`hostCompatibility.sdk` 的 API 版本与 npm 平台实现版本不同，按 README 解释保留骨架值。公开声明中的 `.js` 引用由同名 `.d.ts` 提供类型，不为寻找实现而读取不存在的 JS 或搜索合并后的 bundle。文档足够完成当前业务时，立即实现，不再枚举服务、验证器或页面挂载内部机制。

先列出本轮实际需要的接口，再读取对应公开声明。已确认的工作台 Host/Client 注册方式不重复搜索私有实现；不要为了寻找一种通信方式，依次枚举 typert、commands、client-runner 和全部 Service。当前业务不需要服务端存储、工具或跨进程通信时，不引入这些系统。需要其中某项但缺少公开使用说明时，明确这一个缺口，不用全目录探查替代。首次 SDK 上下文读取完成后，继续实施业务，不每一步重新核验同一版本。真实接口错误或版本变化再重新核对。

开发上下文提供 `sdk.delivery.runner` 时，在官方开发工具当前授权沙箱内运行 `node <runner> <source.directory>`，统一完成构建、Host 启动检查和打包；不复制检查脚本，不重复调用 build 或 pack。其阶段计时只覆盖实际运行的构建、检查和打包，不代表 SDK 查阅、编码、安装或用户验收耗时。缺少入口时沿用旧流程并明确缺口。
