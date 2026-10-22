# WorkDSH 专家插件 / Experts plugin

一个插件管理多个专家与专家团配置。当前源码候选为 `workdsh-plugin-experts@0.1.0-alpha.8`，精确锁定 **DeepSeek Harness 0.2.0-rc.2 / Cordis 4.0.4**；实际构建、安装与运行范围见[验收要求](../../../apps/web/docs/ACCEPTANCE.md)，旧探针和已发布安装包不能证明本轮候选已验收。

WorkDSH manages authored expert assets and immutable revisions. Team execution, messaging, tasks and the Web team panel use the official DSH Agent Teams plugins.

## 专家资产与官方团队执行

- 专家目录、搜索、收藏、复制、草稿、导入导出、启停和确认发布由专家插件管理。页面与 Agent 管理工具使用同一 Host 服务。
- 支持 WorkBuddy 风格作品：`plugin.json`、`agents/*.md`、`settings.json`、README，以及 `skills`、`references`、`scripts`、`templates` 和二进制资源。
- 发布冻结专家定义、成员修订、技能快照和官方 Agent preset。召唤创建原生任务并关联该版本；修改草稿不会静默改变已经发布的内容。
- 团队创建成员使用官方 `spawn_teammate`；消息、等待、中断和共享任务也使用官方工具。团队面板直接加载官方 Client，不再另做一套成员状态面板。
- 已发布成员的 key 对应官方 teammate 的 name。在公开 `agent/created` / `agent/pre-step` 中核验资产、主体和组织，通过 Agent 局部的官方 Persona / Skill Filesystem 插件装配该成员。未配置的成员名在模型请求前拒绝。
- 场景与分工保留为工作指导；任务依赖和状态由官方 Team 及 Session 日志拥有。任务标记完成不等于专业成果已经验收。

## 官方装配

本包的 `cordis.patch.yml` 装配三个精确锁定的官方插件：

| 插件 | 职责 |
| --- | --- |
| `@deepseek-ai/dsh-experimental-agent-team` | 成员、消息、共享任务、持久化恢复 |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | 官方九项团队工具 |
| `@deepseek-ai/dsh-experimental-client-ui-agent-team` | 官方成员与共享任务面板 |

启用 Team 时，按官方 Profile 组合停用旧 `subagent`、`subagent_fork` 及旧控制工具。默认成员创建上限为 16。九项工具为 `spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create`、`team_task_list`、`team_task_get`、`team_task_update`。

WorkDSH 的必需组合仍包含 identity-local、audit、access、skills、experts；可选 bundle 提供工作台导航，activity 仅显示个人工作动态。各包通过官方 Loader/Profile 和公开服务注入装配；无自建 Agent loop、消息邮箱、团队执行表或插件加载器。

## 旧版迁移边界

已删除自建 `TeamRunsManager`、SOP 运行状态机、`workdsh_expert_team_*` 工具及 `workdsh-expert` 委派 provider。构建前清理 `dist`，防止旧执行器残留在新安装包里。

用户的专家、技能、发布修订、文件和旧任务历史保留。旧版委派子任务不再续跑旧调度器，应从专家团重新召唤官方 Team 任务。旧团队运行表不会转写成伪造的官方执行记录。团队配置仍可复用，不要求重建用户作品。

原 WorkBuddy 规范与许可证归属保留在资源目录；平台适配说明维护在 `resources/skills/workdsh-expert-manager/references/authoring-api.md`，团队运行指引维护在 `runtime/team-lead.md`。

## 构建与验证

在仓库根目录使用 Node 22 和固定的 pnpm：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test:integration
corepack pnpm test:activity
corepack pnpm probe:experts:team
corepack pnpm probe:experts:team:web
corepack pnpm probe:experts:team:resilience
corepack pnpm probe:experts:team:real
```

- `probe:experts:team` 使用真实 Loader、生产资产服务与执行准入、官方 Agent Loop/Team/持久化；仅模型 I/O 和受信本地入口使用夹具。验证并行、各成员角色与技能、fresh/fork、非法成员和跨主体拒绝、任务依赖/CAS、模型工具分派、中断及独立进程恢复。
- `probe:experts:team:web` 将七个功能包打成 tgz，通过官方 CLI 安装到仓库外临时 Web Profile；使用实际生产 Host、官方 Team Client、真实浏览器和确定性模型检查成员、任务写入、成员会话与冷恢复。
- `probe:experts:team:resilience` 是同一生产安装探针的发布验收入口，并固定持续运行、人工停止后原成员继续、完整浏览器重连、成员间任务与消息交接、失败状态展示及冷重启恢复。失败由本地模型适配器确定性注入；成员、消息、任务、持久化、Host、Client 和浏览器均走正式实现。
- `probe:experts:team:real` 显式读取已配置的 preview DeepSeek 凭据，在一次性 DSH Home 中创建独立真实执行；真实 lead 创建两阶段任务并通过官方消息与状态工具交给两名真实成员。凭据不进入命令参数和报告，临时副本在退出时删除。
- `probe:experts` 保留专家资产与编辑页面的独立打包回归。

此前 `.artifacts/dsh-0.1.6-upgrade/native-expert-team/` 和 `native-team-web/` 结果属于旧候选历史，不作为当前 0.2.0-rc.2 源码验收。当前实际结果以[验收要求](../../../apps/web/docs/ACCEPTANCE.md)为准。探针使用独立 Home；只有显式 `:real` 命令调用付费模型。

官方 Team 仍为实验性能力。旧候选纯官方 fork 历史查询曾记录 `seeded session constructor seed must equal its inherited prefix` 问题；公共持久化读取与成员冷恢复的通过不能代替 Web 分叉历史验收。默认使用 fresh 成员。真实模型专业成果质量、企业远程多用户和完整热卸载仍须分别验收，不宣称本轮已完成。

## 安装候选包

当前源码依赖 DSH 0.2.0-rc.2 / Cordis 4.0.4，应使用同一次构建产出的配套 tgz；不要把旧 Release 的安装包当作已含本次升级。先在独立 Profile 验证，再部署实际使用的 Profile：

```sh
dsh --profile workdsh --from-default-profile web --dump-config
dsh plugin --profile workdsh add /absolute/path/release/workdsh-provider-identity-local-0.1.0-alpha.6.tgz \
  /absolute/path/release/workdsh-plugin-audit-0.1.0-alpha.5.tgz \
  /absolute/path/release/workdsh-plugin-access-0.1.0-alpha.6.tgz \
  /absolute/path/release/workdsh-plugin-skills-0.1.0-alpha.32.tgz \
  /absolute/path/release/workdsh-plugin-experts-0.1.0-alpha.8.tgz
dsh --profile workdsh
```

在专家入口保存、校验、预览并确认发布，然后召唤。示例只填入原生草稿，发送后才执行；模型与账号在 Harness 中配置。

页面与弹窗使用 Harness 原生主题语义颜色，跟随官方外观设置及系统明暗切换。

可信 Host 可以通过 `ExpertsManagerOptions.agentsHome`（也适用于 `applyExpertsHost(ctx, options)`）指定独立目录；导入、预设编译、包检查与执行 guard 使用同一目录。不传配置保持个人 env/home 默认值。当前企业使用独立账号进程内的同一专家包、官方 Skill filesystem 与 Agent preset；旧共享 Host 的管理/执行 selector 已删除。目录配置不代替会话归属、文件与执行授权。实际企业装配范围见[验收要求](../../../apps/web/docs/ACCEPTANCE.md)。

### 专家技能扫描配置

`ExpertsManagerOptions.includeDefaultSkillRoots` 为可选启动配置。省略或 true 保留个人版默认项目/用户技能发现；false 生成仅使用受管 Skill 快照及专家包资源的官方 filesystem provider 配置。false 参与不可变 preset 标识及输入摘要，不能复用旧的默认扫描 preset。此配置由服务器装配传入，不从浏览器请求接收。独立目录不等于完整企业执行验收；官方 preset/子 Agent 仍需成员组合验证。

### 默认专家种子

`ExpertsManagerOptions.seedDefaults` 出厂不开启：安装后的专家目录为空，三个随包模板（需求分析顾问、文档评审顾问、工作复盘顾问）只在显式传 `true` 时种入本地目录，供探针与本地调试当夹具使用。关闭种子时，旧版本已种下且仍为 `origin: default` 的专家会在首次读取目录时一次性归档（可逆状态，不物理删除），使升级后的目录与全新安装一致；已发布修订、preset 和已绑定会话不受影响。默认专家本身不可编辑（`default-immutable`），用户需要时可复制为个人专家再修改。


### 后台专家目录与本地安装

接入业务后台（`workdshBackend` 绑定）后，专家中心的「全部」改为后台目录，数据来自：

| 用途 | 接口 |
| --- | --- |
| 专家目录 | `GET /desktop-client/expert/queryAuthorizedExpertList`（固定 `status=3`） |
| 专家团目录 | `GET /desktop-client/expertgroup/queryAuthorizedExpertGroupList`（固定 `status=3`） |
| 安装包 | 列表行的 `fjxxList[]`（`filePath` / `fileName` / `fileSize` / `sha256`） |

只有安装到本地才能召唤：`installRemote` 会下载并校验安装包，经现有导入预检后创建本地专家并立即发布；未安装的后台条目只能浏览。包缺少 `fjxxList` 附件时明确拒绝安装；声明的 sha256 不一致也会拒绝。缺少 Skill 依赖时专家仍会安装，但保持未发布状态，召唤会被 readiness 拦下，补齐技能后可重试发布。

`uninstallRemote` 是硬删除：删除 `experts/drafts/revisions/preferences/bindings` 记录、团队派生成员、安装记录，并删除 `presets/wd-exp-*` 磁盘目录。已有会话绑定的数量会随安装状态返回，界面据此二次确认。后台未接入（个人模式/未登录）时，中心页回退到本地目录，行为与之前一致。

### 仅安装用户可用（执行闸门）

`ExpertsManagerOptions.requireInstalledExpert` 默认开启（产品模式）：只有命中 `installations` 记录的专家可以召唤。团队成员按 `teamParentId` 继承主理人的安装状态。自建、草稿、已发布但未上架审核的专家仍可查看、编辑和导出，但 `prepareExecution`／`createExecution`／恢复会话的 `agent/pre-step` 会以 `experts/approval-required` 拒绝执行。列表与详情通过 `installedFromCatalog` 与 `executionBlocked` 告诉界面该禁用「召唤」。探针、Web 预览和开发夹具可显式传 `false` 保留本地执行能力。

### 上架申请与删除

自建专家可在列表或详情点「申请上架」：`submitListing` 用当前草稿导出标准 `.expert.zip`，通过共享附件接口 `POST /desktop-client/upload`（biz = `desktop-client/expert` 或 `desktop-client/expertgroup`）上传，再调用 `expert/listingRequest` 或 `expertgroup/listingRequest`；表单字典来自 `queryAiNodeList`、`getDictItems/yn`、`getDictItems/ai_expert_domain`。上传文件不落本地持久化，提交只进入后台审批流，不改变本地发布状态。

「我的申请」读取后台台账 `queryMyListingExpertList` / `queryMyListingExpertGroupList`（只含当前登录人提交过申请的资产，不限状态）。界面按 `status` 显示草稿 / 待审批 / 已上架 / 已驳回 / 已下架，与「我的专家」同版式卡片展示，并可按审批状态就地筛选；专家 / 专家团页签带各自条数统计。`fjxxList` 在该接口有值，可作为「附件已提交」的依据。列表分页参数为 `pageNo` / `pageSize`，`keyword` 同时匹配名称与描述。

卸载（后台安装）与删除（自建）都是硬删除：移除专家、团队派生成员、`drafts/revisions/preferences/bindings` 记录、`presets/wd-exp-*` 磁盘目录与安装记录。市场安装的专家在「我的」只提供召唤与卸载；自建专家提供继续编辑、编辑、复制、导出、申请上架与删除（不再提供停用/归档）。

### 专家文件持久化与连接器

专家制作文件优先使用显式 `agentsHome`，其次 `DSH_AGENTS_HOME`；两者未配置时使用 `$DSH_HOME/agents`，没有 `DSH_HOME` 时才使用用户目录 `.agents`。容器部署应把 `DSH_HOME` 放在持久卷内；若单独配置 `DSH_AGENTS_HOME`，该目录也必须持久化。缺失或损坏的已发布预设标为不可用，不阻止其他专家启动；修复后应重新发布或重启服务核查，历史修订不自动覆盖。

`futureRequirements` 中 `kind: "connector"` 的 `key` 填已安装连接器 ID。必需项在准备任务及实际创建时检查启用和连接状态，并通过连接器服务选入原生会话；保留会话已有选择。缺失项明确提示，不自动安装或填写授权。可选项不阻止执行，也不自动选中；在原生会话中选择。其他能力类型仍明确标为尚未支持。
