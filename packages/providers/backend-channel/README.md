# 通用业务后台通道

业务后台（Jeecg 平台）的**唯一**请求管线。宿主侧注册一次 `workdshBackend` 服务，功能插件只声明自己的接口路径与字段映射，不各自实现请求头与响应信封。

## 为什么单独成通道

后台请求契约是一致的：固定请求头（含与 `Authorization` 同值的 `X-Access-Token`、当前毫秒的 `X-TIMESTAMP`、固定 `X-Tenant-Id` / `X-Version`，**不发 `X-Sign`**）、`{ code, message, result }` 响应信封、失败时把后台中文 `message` 透传界面。这套契约实现多次会立刻分叉，因此收敛为一处：**请求管线一次，功能只声明路径。**

## 两层结构

| 层 | 入口 | 职责 |
| --- | --- | --- |
| 纯逻辑库 | `workdsh-provider-backend-channel/backend-client` | `BackendClient`：按需取绑定、标准请求头、拼接地址与查询串、解开信封、透传中文错误 |
| 宿主服务 | `workdsh-provider-backend-channel` | `BackendChannelService`：注册 `workdshBackend`，其它插件 `inject: ['workdshBackend']` |

`BackendClient` 的构造参数是「绑定提供者」：`{ binding(signal) => Promise<{ url, authorization } | undefined>, unauthorized?() }`，每次请求前调用一次 `binding`。也兼容旧的函数形态 `(signal) => Promise<{ url, authorization } | undefined>`（归一化为只实现 `binding` 的提供者）。地址与凭据都不在通道内落位：**不缓存凭据、不写入 Host 持久化状态、不进入日志、错误消息或任何返回值。**

## 绑定来源

绑定由身份提供方按需下发，通道自身不产生凭据：

- 绑定不存在（个人模式、未登录、或身份提供方未实现 `backendBinding()`）→ `available()` 返回 `false`，请求抛 `backend/unavailable`。**降级，不抛加载错误。** 身份提供方在取绑定时抛错同样归一为 `backend/unavailable`，不把身份侧的原始错误文本带到上层。
- 地址不在绑定的 `backendUrl` 上、或登录态已失效 → 由身份提供方抛出明确错误，通道不会静默继续。
- 后台把某次成员身份的请求判定为未授权（HTTP 401 或信封 `code === 401`，**无论回包是否 JSON**）→ 抛 `backend/unauthorized`，并尽力调用提供者的 `unauthorized()` 通知宿主触发失效流程。通知抛错被吞掉，绝不用它替换原始错误，也不会因此泄露任何令牌。

## 错误码

消费方按码映射自己的错误码与界面文案，通道不替消费方决定文案：

| 错误码 | 含义 |
| --- | --- |
| `backend/unavailable` | 当前环境没有后台绑定 |
| `backend/address-invalid` | 绑定地址不是合法 HTTPS（或本机回环 HTTP）地址 |
| `backend/path-invalid` | 接口路径不以 `/` 开头，或含查询串/片段 |
| `backend/authority-invalid` | 下发的授权值不可用，通常意味着登录状态已变化 |
| `backend/unreachable` | 网络错误或超时（10 秒，`redirect: 'error'`） |
| `backend/unauthorized` | 后台判定会话失效（HTTP 401 或信封 `code === 401`），`message` 优先为后台原文 |
| `backend/rejected` | 信封 `code !== 200`，`message` 为后台原文 |
| `backend/response-invalid` | 回包不是可识别的 JSON 信封 |

错误按 `name === 'BackendRequestError'` 与 `code` 判定，不使用 `instanceof`：Host 插件的模块实例可能不共享。

## 消费方式

```ts
export const inject = ['workdshBackend'];
const market = await ctx.workdshBackend.available();
const page = await ctx.workdshBackend.get('/some/module/list', new URLSearchParams({ pageNo: '1' }));
```

路径与业务字段映射留在各功能包内，新增功能不需要改动本包；`server.baseUrl` 之类的地址一律由绑定下发，代码不写死任何地址、路径或令牌。
