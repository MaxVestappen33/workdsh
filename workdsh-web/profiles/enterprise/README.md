# 单 ECS 按账号官方进程

当前唯一企业开发路线为一个ECS服务器按账号按需启动官方DSH进程；不同账号数据、配置、凭据和文件目录分离，同账号多个浏览器登录复用进程。共用锁定0.2.0-rc.2官方运行包和基础插件清单，不使用Kubernetes。

个人与企业运行完整官方Web、复用同一共同功能包和页面。企业identity-enterprise/协作/通知显式外置，进程消费固定成员身份与存储服务。Profile是配置组合，不作为账号或授权边界；旧共享多人Host原型已退役。

启动器、网关和Docker配方唯一源码在本仓库 [deploy/member-process](../../deploy/member-process/README.md)；独立 [workdsh-admin](https://github.com/techflag/workdsh-admin) 提供后台、管理前端及登录/账号隔离资源。后台通过Spring AI提供内部模型API，成员在官方自定义模型API页手工输入内部地址、Key、协议、模型；个人模型配置可并存，不自动同步或注入企业provider。

部署验收必须核对启动依赖、真实UID/目录/网络、账号路由、同账号多登录、停用/退出、后台任务保护、冷恢复、会话正文审计、文件/MCP/工具归属及真实模型对话。当前通过和未执行项目见 [STATUS](../../docs/ACCEPTANCE.md)，需求见 [ENTERPRISE-REQUIREMENTS](../../docs/ENTERPRISE-REQUIREMENTS.md)。本地Docker证据不代表ECS实机或Desktop升级完成。
