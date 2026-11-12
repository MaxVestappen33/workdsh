# workdsh-plugin-asset-gate

资产闸门第一期骨架：开关解析、授权快照缓存、纯函数判定器。本期不做市场列表过滤、安装/启停拦截、工具调用拦截、专家准入与模型请求层，也不注册任何数据层入口。

## 能力

- **开关**：生效值 = 后台 `queryGatePolicy` OR 本机收紧项；本机只能把「关」改成「开」。打包默认全关。
- **策略失败口径**：上次成功拉取的策略会持久化（带 HMAC 完整性校验），拉取失败沿用；从未成功拉取过策略时按「开」+ 拒绝（`gate/denied-policy-unavailable`），避免屏蔽策略接口绕过闸门。
- **零开销**：主闸门关闭时不解析身份、不读快照、不算哈希，只按 600 秒周期轮询 `queryGatePolicy`；拿到「开」后立即回到正常同步节奏。某类子闸门关闭时该类完全不判定。
- **快照**：登录后同步一次；之后每 60 秒按 `revision` 比对，命中跳过；进入市场页签、点刷新、安装/启停/卸载完成、窗口重新聚焦时额外触发一次校验（单飞 + 15 秒节流）；到 `staleAt` 自动接力重拉，失败按 30 秒起退避重试、封顶 60 秒，成功前判定保持「已过期」。按账号隔离，账号变化立即清空；落盘使用 AES-256-GCM，密钥由当前登录令牌派生，不落盘。
- **判定器**：`decide()` 是纯函数，输出 `allow` / `deny` 与稳定原因码；原因码集中在 `src/reasons.ts`。

## 接口

后台两个接口由宿主通用通道（`workdshBackend`）携带登录态访问，渲染层不接触令牌：

- `GET /desktop-client/asset/queryGatePolicy`
- `GET /desktop-client/asset/queryEntitlementSnapshot?revision=...`

路径默认值在 `src/backend.ts`，Desktop 运行时通过 `app-config.ts` 注入。

## 服务

```ts
const gate = ctx.workdshAssetGate;
await gate.sync();                       // 登录后：策略 → 按需快照
await gate.decide({ assetType: 'skill', assetId, usage: 'use' });
```

后续轮次在数据层/执行层入口调用 `decide()` 即可，不需要改动本包的开关与快照逻辑。
