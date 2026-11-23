# 会话彻底删除

会话行「…」菜单的最后一项：删除该会话。点击后先弹一次简单确认，确认后从本机永久移除，不做回收站保留。

- 删除范围：会话目录（`DSH_HOME/sessions/<工作区>/<会话编号>`）、投影缓存 `DSH_HOME/storages/session_projcache/sessions/<会话编号>.json`，以及 `origin === 'subagent'` 的子智能体会话（级联）。
- 不删除：分叉会话、工作区业务文件、企业后台审计记录、附件（P1 再做引用计数）。
- 正在使用（live）的会话拒绝删除；当前主视图会话提示先切换。
- 个人模式不显示企业提示；检测到企业身份时确认弹窗多一行「企业后台审计记录仍会保留」。
- 删除过程先把目录整批移入 `DSH_HOME/.workdsh-trash/<批次>/` 并写入清单，用官方 `sessionPersistence.stat` 校验不可见后立即永久删除；任一步失败整批移回原位。
- Host 端点：`POST /api/workdsh-session-delete`（`GET ?mode=1` 仅用于确认弹窗读取身份模式）。实现不修改官方 DSH 文件。
