# 企业业务插件认证接入

企业 Desktop 的业务插件注入 `workdshEnterprise`，复用当前成员登录。服务不返回后台 Token、本机桥接密钥或账号密码。此接口由企业身份插件的 Desktop 入口提供；普通个人空间不提供此服务，页面可提示安装企业连接插件并登录。它不是远程企业 Web Host 的认证接口。

## 独立插件调用

以下代码在插件的 Host 入口执行，不在浏览器页面直接执行。类型从 `workdsh-contracts/enterprise` 导入，Cordis 版本和 DSH 版本须与当前发行包一致。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { EnterpriseService } from 'workdsh-contracts/enterprise'

declare module '@deepseek-ai/cordis' {
  interface Context { workdshEnterprise: EnterpriseService }
}

export default {
  name: 'company-reports',
  inject: ['workdshEnterprise'],
  async apply(ctx: Context) {
    const member = await ctx.workdshEnterprise.identity()
    const reports = await ctx.workdshEnterprise.request<{ items: unknown[] }>({
      plugin: 'reports',
      operation: 'list',
      method: 'POST',
      body: { page: 1 },
    })
    // 将结果交给你的业务服务；不要把身份当作后台授权凭据。
  },
}
```

`workdsh-contracts` 当前是仓库内的私有包，并非已发布 npm SDK。仓库内使用 workspace 依赖；独立项目可构建并打包该包，再使用生成的 tgz 作为类型依赖。不要运行 `npm install workdsh-contracts` 并假设公共 registry 已发布。企业插件运行包按现有 GitHub Releases 独立交付。

## 后台接口约定

上述请求映射为当前公司后台的 `POST /api/extensions/reports/list`，Main 自动补上 `Authorization: Bearer <当前成员登录凭据>`。后台开发者需要实现这个接口，沿用现有成员认证，并从认证上下文确定组织与成员，再检查具体业务权限。SDK 不自动创建报表后台接口。

第一版只接受 GET、POST。插件标识和操作名必须是小写字母开头、后续为小写字母/数字/短横线，长度 1～64；不允许任意 URL、查询字符串或嵌套路径。GET 不携带 body；分页与过滤建议使用 POST JSON。请求体上限 8 MiB，返回 JSON；请求超时 10 秒，无自动重试。写操作如需重试，由业务后台实现幂等键。

`plugin` 是路由标识，不是可信的插件身份，也不授予权限。所有已安装 Host 插件可调用这个服务，后台必须依当前成员校验权限，不能凭插件名称、客户端传来的组织 ID 或角色授权。安装插件本身不提供成员资格；插件仍属于可信本机代码，服务不是恶意代码沙箱。

## 页面与生命周期

业务页面通过自己的 `connection.fetch` 受控接口调用 Host 业务服务，再由业务服务调用 `workdshEnterprise`。不要把 Token 下发到页面，不开放一个让页面任意指定操作和路径的转发接口。页面接口应限定业务操作、校验参数及会话访问权限。

服务在每次业务请求前后核验当前成员。退出、撤权、身份变化或桥接关闭时请求拒绝；可传入 AbortSignal 取消请求。不要复制凭据或缓存身份作为持久授权。管理员权限接口不在桥接范围内，公司模型内部 Key 不能替代成员登录。

此能力要求包含该接口的新 Desktop 与新企业连接包；已发布的 2.0.6-alpha.2 不含该接口，仅升级独立业务插件不能使旧 Desktop 获得扩展桥接能力。
