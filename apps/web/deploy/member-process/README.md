# 单 ECS 按账号官方 DSH 进程

本目录是企业启动器、认证网关、会话桥接、Profile装配及Docker配方的唯一源码。WorkDSH Admin拥有后台、管理前端和登录/账号隔离资源，打包器引用本目录，不维护第二套运行实现。

账号认证后按需登记Linux UID、内部端口和独立数据目录，登记保存在受限/state目录。同账号多浏览器登录复用一个官方进程；退出移除当前登录登记，后台活动未知时保留进程。官方运行包和共同功能插件共用，账号数据、配置、凭据、文件分别隔离。启动器不复制官方Host、Client或Agent loop。

## 从源码准备上下文

先安装并构建本仓库共同功能及企业identity所需包。prepare-context.mjs只读取源码清单和已构建制品，使用锁定官方0.2.0-rc.2 base/Web/CLI及必要peer生成npm锁文件，再复制所需服务器源码和Admin登录资源；不复制运行中的Profile、个人数据或本地proof-base镜像。

```sh
corepack pnpm build
corepack pnpm --filter workdsh-provider-identity-enterprise build
node deploy/member-process/prepare-context.mjs /private/tmp/workdsh-member-build ../workdsh-admin
docker build --build-arg NODE_IMAGE="$WORKDSH_REVIEWED_NODE_IMAGE" -t workdsh-member-server:candidate /private/tmp/workdsh-member-build
```

输出目录必须新建且独立；第二个参数指定Admin源码目录。WORKDSH_REVIEWED_NODE_IMAGE必须是已审查的Node22/24 Debian镜像digest引用，不能省略或改用本地旧验证镜像。新配方使用npm ci安装该上下文锁文件；上下文、tgz、锁文件和artifact-manifest是本地生成制品，不提交。

本轮已实际生成全新上下文及npm锁，核对283个官方DSH包实例统一为0.2.0-rc.2、14个自有制品且无本机绝对路径。尚未实跑新上下文的Docker构建及原生依赖启动。已有候选实验结果不能据此视为新源码镜像已完成。

## 运行配置

必需WORKDSH_ADMIN_URL（后台HTTPS地址）、WORKDSH_USER_ORIGIN、WORKDSH_ADMIN_WEB_ORIGIN及NODE_EXTRA_CA_CERTS。/state使用独立持久卷，账号内部端口不映射宿主；入口监听WORKDSH_PORT（默认8080）。需要NET_ADMIN建立成员端口UID规则，子进程清空capability并启用no-new-privs。实际文件、网络、执行边界仍须部署验收。

根进程只通过外部受限秘密文件读取可选WORKDSH_SERVICE_KEY_FILE，用于固定成员数据库会话桥接；不把全局服务密钥放入成员目录、Profile或子进程环境。不设置时使用官方目录会话。存储选择不自动迁移现有数据。

企业identity显式安装，通过官方settings.section展示姓名、组织、角色和退出。后台Spring AI提供内部模型API，成员在官方自定义模型页手工填写地址、内部Key、协议与模型。不自动注入企业模型provider，不装订单原型。当前配方未安装协作/通知；它们属于外置插件，须另行安装并验证固定成员身份适配。

## 验收边界

已有独立候选验证身份、多登录、部分会话持久化、跨账号拒绝和管理员正文审计，详见 [STATUS](../../docs/ACCEPTANCE.md)。本轮Linux镜像安装/构建、账号页/退出、官方完整UI、共同插件操作及真实模型对话需按最终源码实测；ECS实机、TLS、公网入口、容量、完整后台任务回收与Desktop升级未完成。
