# 账号身份

账号登录身份提供方。用户在工作区登录页（图二）登录后，由 Desktop Main 校验后端返回的用户信息，并把账号身份写入本机受保护的 auth 文件与回环桥。本包在 Desktop 运行期被 `desktopAccountPatch` 注入并取代个人 `workdsh-identity-local`：个人身份不再持有本机运行权限，账号身份取代个人模式。

## 公开入口

| 入口 | 职责 |
| --- | --- |
| 根入口 | 空实现；账号身份只在 Desktop 运行期经运行态 patch 激活，未登录不建立身份服务 |
| `./desktop` | Main 受控本机认证桥与固定账号身份；保留官方本机会话存储 |

## Desktop 本机适配

`./desktop` 的纯 JSON Config 为 `{ authFile, principalId, organizationId, deviceId }`。Desktop Main 先经后端校验账号，再提供这些固定值；插件读取 Main 账号目录中的 `account-auth.json`，核对回环权威的 `authorityUrl`、能力 `authorityKey`、`backendUrl` 及同一用户、组织和设备。authority 仅允许字面回环 `127.0.0.1` 的受控随机端口，拒绝绑定变更。

后端账号 token 仅保存在 Electron Main 内存。auth 文件中的随机能力只允许调用本机桥的封闭路由，不是后端 token；页面、模型和 Profile 不接收它。POSIX 检查文件 0600 权限和当前 UID；Windows 拒绝符号链接并核对文件描述符，依赖 Main 创建的当前 OS 用户 userData 目录 ACL。

通用业务后台通道（`workdshBackend`）的绑定由本包按需提供：每次取用时先复验受保护绑定记录与登录态，再经只读路由 `GET /auth/backend-binding` 取回后台地址与裸 JWT；登录过期一律 401 并明确失败，令牌不缓存、不落盘、不进入任何 Host 持久化状态或渲染层响应，后台地址必须与绑定记录一致。

账号装配须移除个人身份提供方、安装 `./desktop`，并显式启用共同 access 的 `autoBindFixedMemberSessions`。每次账号身份解析都通过 Main 复验固定账号，不因 Profile 或缓存信息放行；登录过期、账号变更或后台不可达时拒绝，不降级个人身份。

客户端仍使用同源 `/api/auth/me` 和 `/api/auth/logout`。Desktop 由本插件贡献这些受官方 Connection 托管的 Host 路由；账号响应含 `desktop: true`，退出响应为 `{ local: true }`。Main 拥有窗口、进程停止、认证文件清理及后台登出生命周期。权限判断逻辑在 `roles` / 权限点就绪后再接入。