# 提示词

会话输入框右侧的「提示词」入口：列出后台授权给当前用户的提示词，点击后把提示词正文插入到当前光标处。

## 职责边界

- 只读列表：查询授权提示词（`name` / `description` / `content`），不做新建、编辑或删除。
- 后台地址、授权头与信封由宿主提供的通用后台通道（`workdshBackend`）负责；本包只声明接口路径，路径由 Desktop 从 `workdsh-app.json` 的 `server` 段注入，未注入时回退到内置默认值。
- 界面只借用官方 Composer 的 `conversation.input.left` 槽位与 `inputActions` 插入能力，不接管会话输入框本身。

## 结构

- `src/service.ts`：宿主侧服务（`workdshPrompts`），分页与字段归一化。
- `src/connection-api.ts`：渲染层端点 `/api/workdsh-prompts`，避免界面直接接触后台凭据。
- `src/client/PromptPicker.tsx`：Composer 弹层（关键词筛选 + 滚动分页 + 点击插入）。

## 验证

```bash
corepack pnpm --filter workdsh-plugin-prompts build
corepack pnpm --filter workdsh-plugin-prompts typecheck
corepack pnpm --filter workdsh-plugin-prompts test
```
