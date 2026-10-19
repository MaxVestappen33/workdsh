# 质量分析工作台

本机界面更新（3.0.0-alpha.23）：仅保留分析总览、检验数据、报告三项业务导航。总览优先显示指标与趋势，切换分析和历史记录按需打开；检验数据直接显示当前检验表与分析操作，导入、列对应按需展开，源文件交给官方会话右侧 Office 面板；报告默认显示正文，显式编辑后才展示文字字段。AI 使用现有原生会话，完成后明确读取并确认采用建议。统计、保存回读和离开保护继续执行；组件回归与本机服务读取不代表实际浏览器界面验收。Word Office 编辑和导出尚未接入，当前报告导出为 Markdown。

WorkDSH 3.0 的独立业务插件，当前为 in_progress 外部插件。正式 Host／Client 包和 worker 已通过官方 npm Profile 的实际安装、启用及冷启动验证；用户本机预览已运行质量业务服务。插件未加入默认 Profile，完整安装版 GUI、企业后端、跨版本迁移及发行验收仍未完成。

已实现完整 CSV/XLSX 后台导入、显式映射与清洗、确定性统计、不可变运行、历史记录、人工报告版本与可恢复草稿。报告编辑器可显式读取本次运行的原生会话或专家解读，预览后重新核对同一候选，再完整追加到分析说明；不自动保存、不替换结论和建议，容量超限时保留原文并拒绝截断。草稿正式保存后归档会产生新修订，页面按归档后的实际修订与原正文读回确认。上述编辑操作已有真实组件控制器回归；真实浏览器交互仍需单独验收。以下历史段落保留实施过程，早期“尚未”描述不代表当前状态。

`src/domain/statistics.ts` 拥有检验/缺陷数据的确定性校验和日趋势、产品对比、Pareto 核心。统计只接受完整、已映射且时区明确的数据快照；非法、重复、孤立数据及不明确复检策略阻止正式汇总，不自动丢行。检验数量不随多条缺陷重复计算；比例按总数量加权，零分母为 null，混合单位及不安全整数汇总拒绝。

该核心不是完整 AnalysisRun、文件解析或授权服务。缺陷单表视图、清洗与排除轨迹、周/月分组、CSV/XLSX、资料库、企业快照、持久记录、页面、报告及 AI 接入仍需实现。身份与资源授权由公开 Host 领域服务执行；不保存 token，不复制项目或资源管理。

交付目标为独立外部工作台插件；共享 Desktop/Web 业务实现，企业 API 按计划仅 Desktop 提供。本模块与平台一样在内核和公开接口验收后才增加正式加载入口，UI 与源码自主实现。

`src/domain/csv.ts` 新增完整 UTF-8 CSV 解析核心：支持引号、多行、转义和 BOM，保留原字符串与前导零；空物理记录忽略，显式空字段保留。重复/空表头、非法编码、列数不一致与超预算整体拒绝，不以预览前缀冒充完整数据。边界为 8MiB、10000 数据行、50 列。`src/runtime/csv-import.ts` 在有界 Node 工作线程执行完整解析，提交时复制输入并计算原字节 SHA-256；最多两个活动线程，超时、取消及关闭终止线程。真实 worker 入口由宿主包提供，不接受请求路径。尚未装配公开 Host 服务；映射、清洗及来源授权仍待接入。

`src/domain/mapping.ts` 提供显式表头映射。检验与缺陷字段白名单独立，必需字段、缺失表头及重复映射拒绝；数量采用严格安全整数，非法值保留原文和数据行编号，不转成零；编号保留前导零，空可选维度保持缺失。日期/复检枚举转换由 normalization 提供，原记录号和物理起始行由 CSV locations 保留；用户修正/排除决策及完整清洗轨迹仍需扩展。

`src/domain/normalization.ts` 根据显式规则转换 ISO 日期、斜线日期或含偏移的时间戳；业务日期按所选时区产生，初检/复检采用明确枚举映射。转换生成新表及 before/after 轨迹，不修改原表；非法日期与未知类型保留问题。该轨迹尚未持久化，调用服务必须检查 issues 后才允许正式分析。

`src/runtime/analysis-run.ts` 构建不可变 CSV 分析快照，包含原表、来源 hash、字段映射、规则、转换轨迹、筛选、确定性结果和内容 SHA-256。映射及标准化问题阻止生成成功运行。该构建器仍需授权服务提供可信来源、绑定 owner/record/project/generation 并持久化；hash 不是权限或来源真实性证明。当前统计仍应移入后台执行，清洗修正/排除及完整算法版本契约待补。

CSV locations 区分数据行、原始记录号及物理起始行，空记录不导致追溯位置错位，多行字段只占一条记录；位置经过 worker、映射、标准化并随分析源快照保留。

`domain/cleaning.ts` 在原表副本上执行明确修正/排除决策：修正要求原值一致，重复及排除冲突拒绝；审计保留原因、Host 提供的操作人、时间和原始位置。analysis-run 保存原表、决策轨迹及清洗后的统计输入。尚未提供授权/UI/持久化；业务服务不得接受页面伪造 cleaningActor，关联缺陷仍由统计孤立检查阻止，不能自动级联丢弃。

`runtime/report.ts` 生成固定 run 的中文 Markdown，包含来源/内容 hash、筛选、口径、汇总、日趋势、Pareto 和人工清洗轨迹；缺陷明细缺失明确显示未提供。报告生成前校验内容 hash，外部文本转义，不产生 AI 原因判断。当前仍缺来源资产版本、项目绑定和保存/下载适配，不能作为完整 W23 验收。

`runtime/run-store.ts` 使用官方 StorageDomain JSON 后端保存每个 owner/record 的分析运行，追加采用 revision CAS、同 ID/同快照幂等、同 ID 不同快照拒绝，并在写入前调用授权 guard；关闭等待已接收写入。当前需服务保证同 owner/record 单实例，非跨进程锁。初始预算每 run 32MiB、每记录 100 个 run/64MiB，超限拒绝，不删除历史；预算尚需产品能力清单及真实规模验收。历史读取核验内容 hash，公开服务仍须绑定身份、记录及 generation。

`runtime/run-service.ts` 消费公开 IdentityService，按 Host 解析身份缓存单一 owner/record store，读写前后核对 profile 与 active membership；切换账号隔离、撤权拒绝。appendHostRun 仅供可信后台分析调用，不开放页面提交 run；实际挂载、来源授权、记录 generation 及企业权限联调仍待接入。

`runtime/bounded-worker.ts` 统一 CSV 与完整分析的工作线程生命周期；`analysis-worker/executor` 将清洗、映射、标准化、统计和快照构建移入实际 Node worker，调用输入独立复制，返回快照重新冻结。worker URL 由可信宿主包指定；实际装配、全量参考机性能及 worker 打包分发仍待验收。

`run-service.analyzeAndSave` 在分析前固定 Host actor 和原输入，清洗操作人由该 actor 提供；执行实际后台分析，返回及写入前再次核验身份与调用者提供的 record revision/generation/context guard，成功后保存到启动身份的 store。尚需真正记录管理服务实现 guard、来源授权及持久上下文；回调存在不能替代这些验收。

记录 context/configure 持久保存 generation 和最小配置引用，配置更新采用 generation CAS，后台分析提交在同一 store 串行队列检查启动 generation，阻止配置变更期间的旧运行提交。配置引用目前须由可信 Host 调用方提供，尚未解析真实 sourceSnapshot/mapping revision、完整筛选或项目绑定；不能将这些 ID 字符串当作已授权来源。旧 planned 存储缺 generation 时默认 0，正式 schema 迁移待版本冻结。

`runtime/library-source.ts` 通过公开 LibraryService.readOriginal 获取明确 assetId/revisionId 的完整原字节，禁止缺版本或默认最新；读取与解析前后复核当前授权回调。CSV worker 计算实际 hash，资产/固定版本随来源保存并进入报告。当前公共端口测试为 fixture，实际 LibraryManager/Host 选择器和撤权联调仍待验收，XLSX 尚未接入。

真实 LibraryManager 与官方存储联测已覆盖 CSV 原字节/hash、错配版本、其他 owner 及停用资产拒绝；这是 headless 跨模块验证，尚未包含安装版选择器/GUI 或企业撤权。跨模块测试前需先构建 library 当前源码，不能以过期 dist 作为证据。

`runtime/xlsx-worker/import` 在实际后台调用共享 readWorksheetTable，明确表头行、多表需选择，不截断；保留原生数字/文本值、工作表/表头/读取策略及原文件 hash。通用 raw-table 使 CSV/XLSX 复用映射和清洗；数量直接校验原生数字，不把空单元格当零。实际 worker 测试覆盖工作表选择、类型、统计和公式缓存拒绝。正式包的 tabular 依赖版本/worker 分发、来源选择器和完整安装验收待完成。

`client/QualityResults.tsx` 提供质量结果视图：指标卡、日趋势、产品对比和缺陷分布，区分空记录、后台运行、失败、校验阻塞及完成；缺失缺陷明细明确展示未提供。明细每页 50 项，避免一次渲染全部维度；不在浏览器读取文件或计算统计。浏览器构建/类型检查已验证，尚未挂载宿主、形成四标签完整页面或通过 GUI/交互验收。

`runtime/report-library.ts` 通过公开 LibraryService.importAsset 保存固定 run 的 Markdown，按 actor/run/content/report hash 形成稳定 operationId；实际返回资产/版本/hash 再核验，重复保存复用既有成果。真实 LibraryManager 联测已贯通资料 CSV→解析/分析→Markdown 入库→原文件复读与重复保存。宿主服务必须先授权读取 run，项目资产关联、成果回执持久化及 UI 尚未接入。

`run-service.saveReport` 仅从当前授权 owner 的历史 run 生成报告，实际资料入库后持久保存成果回执；不存在的 run 拒绝，同 operationId/回执幂等，不同回执冲突拒绝。官方存储和真实资料联测覆盖重复保存及服务重开找回成果。外部入库成功但回执保存中断时，可按稳定 operationId 重试恢复；项目关联及 UI 仍待接入。

`runtime/report-project.ts` / run-service.linkReport 在显式选择项目后关联已存报告，先由资料 owner 读取固定版本并核验 hash、节点，再由 ProjectService.get/addAsset 创建引用。失败保留报告，重试依赖项目现有 asset/revision 幂等；不修改历史 run 或建立第二套项目管理。真实项目/资料/存储服务联测覆盖关联、重复重试及项目不存在时成果保留。历史项目上下文捕获、引用回执持久化与 UI 仍待完成。

项目关联回执随记录持久保存（项目 ID、真实引用 ID、成果 operationId、资料版本），重复关联同引用幂等。项目中删除后显式重关联可取得新引用，并保留旧回执作为历史；回执仅证明曾关联，读取当前状态必须再询问项目 owner。真实联测覆盖重开与删除重关联，不级联删除报告。正式 schema 迁移、关联状态 UI 及历史 run 项目上下文仍待实现。

分析可选项目通过真实 ProjectService.get 获取启动时 projectId/name/configRevisionId，写入内容快照及报告；保存前再核验项目可访问，后续项目配置变化不改写历史上下文。未关联项目时仍独立运行。真实联测覆盖配置更新后历史引用不变及已归档项目拒绝；完整记录选择绑定、技能/连接器配置快照与原生 AI 会话仍待接入。

`runtime/statistics-export.ts` 生成固定 run 的日趋势、产品对比及 Pareto CSV，保留比例小数原精度，空分母/缺失缺陷来源留空，缺失产品有单独标记。文本字段 RFC 引号转义，公式前导文本加字面 apostrophe 并返回 protectedTextCells，原快照不改；导出清单含 run/content hash、时区、单位和文件 hash。宿主下载、资料入库、预算/后台执行及 UI 仍待接入。

统计 CSV 可通过 run-service.saveStatistics 从授权历史 run 保存至真实资料库，Markdown/CSV 共用实际资产回执核验与持久化，回执区分格式和明细类型。重复保存幂等，重开后成果引用保留。实际 CSV 资料联测已通过；后台导出、下载选择器、CSV 口径元数据文件及 UI 仍待接入。

`artifact-worker/executor` 后台生成 Markdown/CSV；运行服务保存成果必须具备实际 executor，没有时明确失败，不回退到主线程生成。返回后校验请求格式、run/content 绑定并复核身份，再入库和保存回执；单成果实际字节限制 8MiB。实际 worker→资料→项目/持久存储联测已通过，正式 worker 分发、完整预算/取消性能和 GUI 待验收。

`client/QualityWorkbench.tsx` 连接总览、检验、缺陷、报告四标签及记录选择/新建/导入/配置/分析/成果入口，全部消费 Host callbacks，明细每页最多 50 行；身份或记录改变时重挂载并取消未完成页面请求，显示真实运行/失败状态。AI 按可用回调显示。当前未挂载，导入、映射、清洗对话框及 callbacks 的真正宿主接线仍待实现；浏览器构建不是 GUI/交互验收。

`runtime/record-index.ts` / service.listRecords/createRecord 保存 owner 隔离的业务记录索引，Host 生成稳定记录 ID，以 operationId 实现创建重试幂等/冲突拒绝；记录可先创建、后接入数据与分析。官方存储联测覆盖新建记录关联运行、账号切换列表隔离和服务重开找回。尚需公开记录 API/页面接线、改名/归档、旧原型记录恢复及完整 schema 迁移，不能把索引当完整记录管理。

### 记录连接接口（未装配）

`src/runtime/record-rpc.ts`提供计划中的Host POST处理器，仅开放list/create业务字段，身份由既有QualityAnalysisRunService解析。16KiB流式请求预算、严格UTF-8及字段校验、幂等冲突和取消错误已验证；页面不能提交成员、组织或存储路径。尚未注册宿主路由，真实连接授权、Client代理及安装版界面不在此次通过范围。

记录Client代理`src/client/record-client.ts`已对接上述处理器协议，固定同源路由，不接收凭据或身份字段；结果结构、重复ID及创建回执匹配均校验。创建重试沿用调用方保存的operationId，取消及30秒超时由请求信号传播。该代理尚未挂接真实连接服务或工作台页面。

`records-host.ts`新增内部Cordis装配函数，使用已有storageDomain/workdshIdentity/connection服务注册streaming POST，并随插件生命周期撤销路由和关闭持久服务。内部装配在真实Cordis及官方存储中验证了卸载与重开恢复；connection注册使用测试适配，尚非安装版Profile接入或网络准入验收。Worker executor归外层Host所有，仍须最终组合及关闭。

`record-controller.ts`及`QualityRecords.tsx`连接记录列表、新建名称、刷新和打开回调。创建结果未知时保留同一operationId，刷新可按已确认记录解除待核对状态；取消/身份作用域结束后不接收迟到结果。控制器按身份单独创建，外层Client负责最终dispose。组件尚未接入正式Slot及QualityWorkbench的完整业务控制器；当前操作意图仅内存保存，跨重启未知创建恢复仍待实现。

记录接口新增get，必须在当前身份记录索引中存在才读取其context，返回revision/generation及配置引用；跨成员访问返回不存在，不隐式为猜测ID建立业务记录。Client校验返回记录ID、配置结构和版本计数；记录页打开与创建后打开均先读取Host详情。配置目前仍是映射/来源引用，完整输入恢复及历史run分页接口尚待实现，不能宣称完整分析恢复。

历史摘要：新保存run同时持久化runId/createdAt/contentHash及检验、不合格件数，runs请求每页最多20项、按保存顺序倒序，expectedRevision避免分页时新增run导致错位。当前仅摘要读取，不加载原始输入到页面；早期无摘要记录按当前页解码验证兼容。完整run内容完整性仍由读取/复算验证，摘要不是重新校验原始数据的证明；正式schema迁移、客户端历史列表及性能验收仍待完成。

历史Client已支持runs分页并校验数量、hash、非负安全整数、重复ID和预期revision。QualityHistory组件展示时间、检验/不合格件数和内容指纹，按当前revision翻页，变更冲突提示刷新；记录/身份切换取消旧请求。选择仅提供受验证摘要回调，尚未完成单run图表、报告恢复或正式Slot挂接。

单run恢复：run-view按recordId/runId/contentHash读取当前身份已知记录中的固定run，验证内容hash后返回原统计和缺陷来源可用性，不重新套用当前配置。includeReport要求真实artifact executor，以原run生成Markdown并核对回执；缺少executor返回503。接口不返回原始dataset/sources。Client结果解码与历史结果组件仍待接入；当前单run JSON读取/hash验证在Host执行，大输入性能及后台迁移仍需验证。

历史结果Client：run-view.ts校验记录/run/hash、统计数组预算、安全整数、字段结构和时区，返回冻结副本；record-client.view消费固定run接口。QualityHistoryResult按身份/记录/run/hash隔离展示，复用QualityResults指标图表，报告按需读取、失败可重试，文本安全显示。尚未正式挂接工作台；Markdown富文本与报告版本兼容仍待完善。

QualityAnalysisBrowser组合记录、历史分页和固定历史结果组件，打开记录后清除上一所选run，按当前记录选择历史结果；controller在身份/client作用域结束取消并关闭，兼容React开发模式effect重放。此页面仅已保存分析的浏览和记录创建，不代替完整导入/分析工作流，也尚未注册正式工作台入口。

资料XLSX：importQualityLibraryXlsx通过LibraryService.readOriginal读取指定asset/revision原字节，交给有界真实XLSX worker；保留工作表/headerRow/valuePolicy、原hash及资料版本。多工作表未选择返回worksheet_required，不产生可分析输入；读取/计算前后复核授权，迟到结果拒绝。实际LibraryManager和worker集成已验证，但资料选择UI及公开输入RPC仍待接入。

趋势粒度：QualityFilter.trendGranularity支持day/week/month，按已标准化业务日期分组；周以周一开始，月以首日开始，筛选仅纳入边界内记录，不补齐周期外数据或伪造空周期。新AnalysisRun算法标识quality-statistics/2，保存粒度；旧run保持原hash和原日趋势，Client允许旧记录未含粒度。报告、CSV和图表周期标签一致；粒度选择交互仍需接入完整配置页。

QualityMappingForm提供检验/缺陷列映射、明确时区/日期格式/初检复检值、复检策略及趋势粒度，按身份和来源键重置并取消保存。字段列表由映射领域唯一导出且冻结；共享configuration校验必填、重复/失效表头与口径。不自动猜测，onApply仍需实际Host源版本及保存服务，当前不是已接通导入工作流。

来源保存：官方记录存储新增sourceSnapshots，Host可信解析输出经有限schema验证、复制并以JSON内容hash标识保存，单快照32MiB、每记录最多10个/64MiB，重复输入复用。读取验证快照hash并返回新对象；generation变更、撤权、跨记录和跨成员拒绝。stageHostSources为Host内部接口，不开放页面自报complete/sha。正式schema迁移、原文件长期保留策略、完整配置绑定和实际输入RPC仍待完成。

完整配置绑定：bindSourceConfiguration在官方记录事务队列内读取已保存来源、验证实际表头与规则，再保存不可变配置json及hash，原记录mappingRevision指向真实配置，generation递增。configuredSources校验配置/来源hash并恢复完整输入；analyzeConfiguredAndSave使用Host生成runId/时间与真实worker，期间配置变更阻止提交，旧run保持原口径。旧仅含未解析配置引用的记录明确configuration-unresolved。当前尚无对应公开配置RPC或表单接线，正式schema迁移及性能仍待完成。

配置/分析连接接口：configure严格验证业务字段，按实际存储来源校验映射；analyze仅接受recordId/expectedRevision，由Host恢复完整输入并调用受控executor。成功只返回run标识/hash/时间和revision，阻塞返回前100项及总数，明确不代表全部问题；无executor返回503。Client校验保存回执和分析回执。实际Host mount可注入analysis executor，但正式worker包组合及表单接线尚待完成。

configuration读取接口返回完整已保存映射、规则、筛选及来源表头/行数/hash/格式/资料引用，不返回原始行。Client校验结构与实际元数据表头；QualityConfigurationEditor连接读取、预填表单和保存后刷新。QualityMappingForm保留已有维度/日期筛选，明确复检策略修改；原枚举值保留空格，不静默转换。当前编辑器未接入正式入口，首次来源配置的导入承接仍待完成。

import-library接口：只接收当前记录、资料asset/revision、CSV/XLSX选择和期望generation，由Host原资料owner读取并使用真实importer；指定已有来源快照可追加缺陷表，不能无检验来源直接拼接。导入前后授权、来源所属记录和配置版本验证，Excel选表未完成不保存来源。Host mount接受可信输入服务组合，正式包资源与页面来源选择仍待实现。

资料输入Client与交互：importLibrary校验已保存来源回执及worksheet_required状态，CSV不接受待选表响应。QualityLibraryImport使用外层现有资料owner选择回调，展示固定版本、表头行和工作表，完整导入后返回可信快照元数据。CSV只允许首行表头且无工作表参数，避免配置被忽略。实际XLSX公共接口已验证待选表→选表保存→配置恢复，但选择回调尚未绑定正式LibraryPicker/Slot，未GUI验收。

## 工作台复用 Office 的开发要求

工作台处理 Excel、CSV、Word、PPT 等文件时，优先使用 WorkDSH 已有 Office 插件及官方文件入口。文件预览、电子表格网格、单元格编辑、工作副本保存和支持格式的导出由 Office 拥有；工作台只实现业务字段映射、质量规则、清洗决策、统计、异常定位和报告组织，不新增独立电子表格编辑器或重复文档管理。业务指标表、异常列表与字段映射表单仍可由工作台展示。

开发前读取实际 Office 能力及版本，区分只读 CSV 预览、已有 XLSX 文件编辑与 Excel 工作副本接口，不能将某一路径支持的功能推定为全部支持。通过公开服务、明确资产/文档 ID 与修订关联；缺少公开接口时先在 Office 所有者中补充共享契约，并验收授权、生命周期、保存及导出，再接入工作台，不直接调用 Office 私有模块。

统计必须使用经过授权的完整数据，而不是 Office 预览的截断行列。开始分析时固定完整源文件或已保存工作副本的修订、内容摘要、工作表和区域，形成不可变分析快照；修改后重新保存并生成新运行，不改写历史结果。保留必要的后台完整解析与确定性计算，复用共享解析能力；Office 预览或编辑失败不得被当作成功导入。

验收必须覆盖：由工作台打开实际文件的 Office 入口；编辑并保存后分析使用新修订；历史运行仍引用旧快照；预览截断不影响完整统计；未授权、Office 未安装或能力不足时明确提示，不生成虚假成功或临时自制编辑器；支持的导出得到可打开的真实文件。上述场景通过前不得宣称 Office 与工作台已经打通。

## 工作台作为多模块业务系统的要求（优先于单页原型描述）

每个工作台插件是一套可独立使用的小型业务系统，一个安装包对应一个稳定工作台身份。平台侧栏提供系统入口，打开后由插件呈现内部导航、多页面及业务流程。多个内部模块不生成多个插件，不复制或替换官方宿主、Loader、会话及平台资源管理。

首次制作必须先定义系统结构：业务目标、角色、模块清单和稳定模块ID、模块页面与导航、领域对象及关系、数据来源、操作和状态流转、Host服务及授权、可选项目关联、存储修订和迁移、模块间依赖、首轮范围及逐模块验收。页面布局是系统设计的一部分，单个页面生成不代表系统完成。

质量分析系统目标模块：分析总览；数据管理（本机/资料/企业来源及完整版本）；校验清洗（字段映射、异常和人工决策）；分析任务（分析记录、运行状态与结果）；报告中心（固定运行报告和历史）；系统配置（质量规则、资源引用和可选项目）。模块复用现有领域服务，避免每个页面独立维护另一份数据。任务执行复用既有服务与原生运行能力，不另造宿主执行器。

局部修改分为业务模块和页面组件两级。用户可在系统导航或模块树中选择业务模块，查看其页面、数据、接口和依赖，再描述调整；界面布局修改可进一步选中组件。页面属性变化通过受控配置保存；业务功能变化进入同一插件源码迭代、构建及更新。Agent必须说明跨模块影响，并对受影响数据、流程及其他模块执行回归；不得把可视化编辑器解释为业务系统生成器。

普通用户通过提示词创建，并以自然语言反馈持续修改同一个插件；本版本不集成 Puck 或组件编辑器。复杂系统由专业开发者离线开发并导入更新。Excel 和文档编辑继续复用系统 Office。

验收以多页面业务闭环为准：数据管理导入固定来源→校验模块保存可追溯决策→分析任务生成运行→总览读取相同运行→报告中心输出同一快照；重启后状态一致。仅修改总览样式不会改变清洗、统计和历史；更新某个业务模块能列出并验证受影响模块。当前单页原型仅作为局部交互示意，需要重新制作系统级原型，未获得用户整体确认。


正式包使用 workdsh-plugin-quality-analysis@3.0.0-alpha.1；Host 在官方 Cordis 生命周期中创建后台 CSV/XLSX、分析和报告 worker，复用资料库原字节服务。Client 通过平台公开注册服务提供页面，复用资料库公开选择器和管理代理。构建包含固定 worker 文件及拥有的契约声明；不得将构建通过视为包依赖闭包、实际加载或 GUI 验收。


实际官方 npm Profile 已验证本包通过管理接口安装／启用、Host 身份注册、资料库固定版本 CSV 导入、后台统计及固定运行报告读取，第二次启动恢复同一历史结果。此验证尚不包含真实浏览器 Client／资料选择器加载或 GUI、报告入库按钮、企业接口及发布候选验收；插件保持 in_progress。


质量报告 save-report 接口与历史报告保存按钮已接线：Host 先核对固定运行指纹，再通过真实资料库入库并保存回执，重复保存同内容／标题复用资产及版本。官方安装 Profile 两次启动验证该接口幂等；浏览器按钮实际交互与 Office／项目关联操作仍待验收。


已保存报告可通过公开 projects／link-report 接口选择已有项目并建立资产引用。项目关联保持独立且可重试，不改变固定分析运行，不复制资料文件或项目管理。未加载项目服务时返回明确未就绪状态，报告仍在资料库。实际页面选择与企业授权联测仍待验收。


Client 元数据显式声明平台／layout 注入和资料库公开组件 external 依赖；平台包具有正式 web Client 声明。官方发布的 ClientModuleSystem 分发文件解析与实际 Profile HTML 模块图已验证依赖顺序；React／原生服务种子夹具测试不能代替实际 DOM 与 Slot 交互验收。

## 已保存来源恢复

sources 记录接口返回当前成员拥有记录的已保存来源快照元数据，不返回原始行。数据管理页可显式读取、选择固定快照，并继续配置字段映射；不自动选取历史来源。多个来源及其资料修订、工作表和指纹在选择后可核对，旧分析运行保持原快照。配置提交由 Host 再检查来源所属记录和 generation。

实际 Client→RPC→Host→官方存储测试覆盖导入后服务关闭重开、读取来源、用返回 snapshotId/generation 保存映射并由真实 worker 分析，结果检验 100、不合格 1。该证据不替代浏览器选择及完整进程冷启动验收。

历史运行视图返回仅属于当前 runId/contentHash 的已保存成果回执。客户端严格核对身份、格式和去重，重新打开结果页可恢复报告与 CSV 统计表保存状态，并使用原报告回执关联项目。官方隔离 Profile 两次冷启动已验证报告回执恢复；实际页面按钮仍待 GUI 验收。回执记录历史保存事实，后续访问和项目关联继续通过资料库核对版本及权限。

检验数据页只挂载一个可核对的业务表，统一查看记录、修正决定与分析提交。来源或规则变化会重新读取并使旧决定失效；隐藏模块保留同源输入。源文件经资料库公开入口在官方会话右侧文件面板打开，复用系统 Office，文件页提供“返回当前分析”。CSV 保持只读，Excel 保存为资料库新版本，返回同一分析后仍须明确采用再重新分析；导入和分析规则按需打开。当前官方全屏工作台会隐藏会话右侧面板，打开源文件会切回真实会话，不使用工作台内源文件弹窗。该调整的组件事件及原字节保存测试不替代浏览器视觉验收。

## 结果与原生会话联动

趋势点可展开本次已保存分析内的检验记录。选择记录后，“与 AI 核查”将核查对象交给同一原生会话；图表选择本身不发送消息，也不改变统计范围。已有输入或执行中的会话保留原状态，待用户处理后再交接。

`focusInspections` 返回当前统计纳入的记录及原行位置；`aiFocus` 校验当前会话、结果版本、维护锁和并发修订。`quality_read_context` 返回实际聚焦证据，`quality_read_focused_inspections` 读取续页。重新计算会清除旧焦点，报告仍引用完整分析结果。
