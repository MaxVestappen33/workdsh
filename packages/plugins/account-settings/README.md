# 账号设置入口

侧栏底部的个人账号入口。它占用官方 `settings.launcher` 单槽位，取代官方回退的「设置」行：账号可用时显示头像与姓名，菜单里包含账号信息、设置入口、插件广场入口与退出登录。

## 公开入口

| 入口 | 职责 |
| --- | --- |
| 根入口 | 空实现；本插件只有客户端展示，不注册 Host 服务、存储或凭据 |
| `./client` | 注册 `settings.launcher`，渲染入口、菜单与退出确认 |

## 槽位与数据

官方 `ui-settings-general` 占据侧栏底部的 `sidebar.settings` 座位，并在其中渲染 `[settings.launcher, 连接状态, 更新状态]`；`settings.launcher` 没有占用者时回退成官方的「设置」按钮。本插件注册该槽位，因此底部不再出现独立的「设置」行，设置功能从账号菜单进入，打开的仍是同一个官方设置弹窗。

账号信息与退出使用 Desktop 已提供的同源路由：`GET /api/auth/me` 返回 `displayName`、`organizationName`、`avatar` 等字段，`POST /api/auth/logout` 返回 `{ "local": true }` 后由 Desktop Main 清理会话并切回登录页。后端 token 只存在于 Electron Main，页面只读取展示字段。

## 降级与边界

- 官方 `ui-settings-account` 的账号菜单只在注入 `dshDesktop` 的官方桌面壳里注册；WorkDSH 载体不注入该标记，本插件使用同一条判定，两者互斥，不争抢单槽位。
- `/api/auth/me` 不存在或读取失败时（例如浏览器形态），入口退化为「设置」（图标 + 文字），菜单只保留设置项与插件广场项，不显示账号信息与退出登录。
- 「插件广场」由第三方 SkillHub 插件可选提供：打开菜单时若其入口按钮不存在，则不显示该项；点击该项触发的是 SkillHub 自己的广场浮层，WorkDSH 只隐藏它在侧栏的重复展示。
- 头像优先使用后端返回的图片地址，加载失败或未提供时回退姓名首字；不因远端图片失败而阻塞界面。
- 退出登录先经二次确认，失败时留在原地并显示错误，不做乐观跳转。
- 本插件不判定权限：`roles` / 权限点就绪前只展示账号信息。扩展契约见 [官方 Harness 扩展规范](../../../apps/web/docs/HARNESS-OFFICIAL-DEVELOPMENT.md)，模块登记见 [modules.json](../../../apps/web/docs/modules.json)。
