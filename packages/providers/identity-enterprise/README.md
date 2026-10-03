# 企业身份、账号与 Desktop 正文同步

当前候选版本为 `0.1.0-alpha.2`，官方版本族为 DSH `0.2.0-rc.2`、Cordis `4.0.4`。本包随 Desktop 的不可变运行时安装交付，仅在企业登录后由受控企业装配启用；员工无需安装 tgz。个人 Web 默认组合和个人 Desktop Profile 不启用本包。企业 Web 由服务器显式装配同一包。根入口只贡献客户端账号页；具体身份提供方必须由受控企业装配选择。旧共享多人 Host、runtimeToken 和登录 onboarding 原型已退役。

## 公开入口

| 入口 | 职责 |
| --- | --- |
| 根入口与 `./client` | 在官方 `settings.section` 贡献同一个“企业账号”页；Node 根入口不建立身份服务 |
| `./process` | ECS 固定账号进程身份，提供 `workdshIdentity` |
| `./process-supervisor` | 服务器外层按账号登录登记与原生进程生命周期 helper |
| `./process-sessions` | 官方 `SessionPersistence` 的企业后台存储适配，仅用于服务器组合 |
| `./desktop` | Main 受控本机认证桥、固定成员身份，以及本机可见正文同步；保留官方本机会话存储 |

`@deepseek-ai/dsh` 精确 peer 声明为 optional，由 Desktop 的官方安装 anchor 提供并核验实际版本；不因此安装另一套 DSH。实际使用的 Session Controller、Session、Connection 和官方客户端 peer 仍为精确版本要求。

## 企业 Web 与服务器进程

`./process` 显式接收 `backendUrl`、`authFile`、`principalId` 与 `organizationId`。只读取 Host 受限认证文件，经后台验证当前登录并核对固定组织和成员；失联、登录失效或主体不匹配时拒绝，不回退个人身份。认证内容不进入 Profile 源码、客户端、日志或提交。

账号页从浏览器同源 `GET /api/auth/me` 读取真实姓名、组织与角色；`POST /api/auth/logout` 撤销当前浏览器登录后返回登录页。使用官方 Slot 生命周期，不复制设置 owner。

服务器目标保持单 ECS 按账号按需启动独立官方 DSH 进程；同账号多个浏览器登录复用进程，各账号分别拥有数据、配置、凭据和文件目录，共用运行包与基础插件。Profile 是组合，不是账号或安全边界。

`process-supervisor` 默认退出只移除当前登录登记；只有完整活动适配确认 idle 才允许回收。缺省、busy、unknown、异常或重新登录竞争时保留，空 Session 列表不能证明后台任务已全部结束。网关仍须核验每个浏览器的当前登录。

`process-sessions` 复用官方 SessionPersistence 和后台授权存储。服务器内部存储接口及其 service key 不用于 Desktop；管理员正文读取和审计由后台专门授权接口承担。

## 企业 Desktop 本机适配

`./desktop` 的纯 JSON Config 为 `{ authFile, principalId, organizationId, deviceId }`。Desktop Main 先经后台核验成员，再提供这些固定值；插件读取 Main 所属账号目录中的 `enterprise-auth.json`，核对 `authorityUrl`、桥能力 `authorityKey`、`backendUrl` 及同一成员、组织和设备。authority 仅允许字面回环 `127.0.0.1` 的受控随机端口，拒绝重定向与绑定变更。

真实后台成员 token 仅保存在 Electron Main 内存。文件中的随机能力只允许调用本机桥的封闭路由，不是后台成员 token；页面、模型和 Profile 不接收它。本包不持有服务器 service key。POSIX 检查文件 0600 权限和当前 UID；Windows 拒绝符号链接并核对文件描述符，依赖 Main 创建的当前 OS 用户 userData 目录 ACL。目录分离不构成同 OS 用户之间的安全沙箱，Windows 实际打包尚未验收。

企业装配须移除个人身份提供方，安装 `./desktop`，并显式启用共同 access 的 `autoBindFixedMemberSessions`。每次企业身份解析和同步操作都通过 Main 复验固定成员，不因 Profile 或缓存信息而放行；登录过期、成员变化、密码待修改及后台不可达时拒绝，不降级个人身份。

客户端仍使用同源 `/api/auth/me` 和 `/api/auth/logout`。Desktop 由本插件贡献这些受官方 Connection 托管的 Host 路由；账号响应含 `desktop: true`，退出响应为 `{ local: true }`，页面不跳转远程登录。Main 拥有窗口、进程停止、认证文件清理及后台撤销生命周期。账号页同时显示同步状态，并提供重试与明确的后台正文删除操作。

本包不注册模型 provider、不自动写入模型配置。企业成员仍在完整官方自定义模型 API 页手工填写公司内部地址、Key、协议和模型；个人自配模型可以并存。协作和通知仍是独立外置插件，本次身份适配不表示其 Desktop 装配已完成。

## 可见正文同步契约

同步监听官方公开 `session/created`、`session/event` 与 `session/flush`，随后通过共同 `workdshSessionAccess.inspect` 冷读，核验真实固定成员及 Session 所有权。上传范围只包括 `source.kind === 'user'` 的用户文字和已提交的助手文字，包括已提交的中断前缀；系统消息、注入内容、思考、工具轨迹和附件不进入 payload。

正文是按官方事件序号稳定标识的可见文字日志：后续编辑不会改写已上传的旧前缀。客户端只提交 `{ version: 1, deviceId, sessionId, revision, requestId, entries }`，entry 仅含 `{ seq, recordId, role, text }`；组织和成员由后台当前登录确定。Main 注入冻结设备，后台拒绝同一 Session 的无约束多设备写入。

受保护的 `enterprise-visible-sync.json` 与 authFile 位于同一账号目录，保存待发送正文、修订及 requestId。发送前持久化请求；丢失回执时重试原 payload，不生成另一份记录。后台只接受严格新增的不可变前缀，返回实际修订与条数；失败保留本地记录和错误状态，不虚报成功。后台限制 JSON 512 KiB、512 条、单条文字 64 KiB、文字总计 256 KiB；超限拒绝，不静默截断。

删除后台正文前先持久化删除意图并暂停该会话上传。后台 tombstone 幂等，丢失响应可在重启后重试；确认后该会话不再上传。本地官方会话数据保留。`session/disposed` 只是释放/回滚，不被当作删除事件；官方界面本地删除也不等于后台正文删除。

客户端过滤已知 private key、API token、JWT、Bearer 等形状及实际桥能力，后台也拒绝明显凭据形状；这不能语义保证任意正文不含秘密。后台接收的是客户端提交的可见日志，不是不可绕过的终端完整审计。管理员读取须由后台组织范围授权且留访问审计，不能获得成员凭据或 Host 管理权限。

## 验收要求

构建和类型检查必须覆盖本包以及共同 access；身份测试覆盖后台认证、固定成员、同步重试和删除、过期和撤权拒绝、认证文件保护以及 process 生命周期。通过源码和 headless 检查后，仍需分别验收企业服务器部署与 Desktop 安装、登录、退出、重启、升级及 Windows/macOS 图形行为。模型和工具任务须通过实际授权的完整官方客户端验收；文件目录或 Profile 名称不能替代身份与资源授权。

共享功能与交付要求见 [功能开发契约](../../../apps/web/docs/FEATURE-DEVELOPMENT-CONTRACT.md)、[企业需求](../../../apps/web/docs/ENTERPRISE-REQUIREMENTS.md) 和 [验收要求](../../../apps/web/docs/ACCEPTANCE.md)。
