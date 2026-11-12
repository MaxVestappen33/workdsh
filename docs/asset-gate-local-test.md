# 资产闸门链路本地测试文档

面向本地开发与测试人员，按「操作 → 预期结果 → 不符合时怎么判断」逐条执行。

- 适用环境：本机后台（`ytsj-ai`）+ 本机打包/开发态客户端
- 覆盖范围：技能类资产（`skill`）的授权闸门、验签闸门、撤权账本、审计上报
- 不在范围：见第六节
- 原因码、字段名、接口路径全部取自当前实现，可直接用于检索代码与日志

> 约定：`$BASE` = `http://127.0.0.1:18080/ytsj-ai`，`$TOKEN` = 后台登录后请求头 `X-Access-Token` 的值。

## 测试进度

| 总条数 | 已通过 | 失败 | 未测 | 最近更新 |
| --- | --- | --- | --- | --- |
| 30 | 29 | 0 | 1（不可复现） | 2026-11-12 |

统计口径：第一～四节共 30 条（1.x 七条、2.x 五条、用例 1～15、4.x 三条）；第五节为排查参考、第六节为范围声明，不计入。

已通过明细：

| 编号 | 内容 | 结果 | 日期 |
| --- | --- | --- | --- |
| 1.1 | 后台启动与 classpath 私钥告警（预期行为） | 通过 | 2026-11-10 |
| 1.2 | 策略表 `ai_asset_gate_policy`（9 行） | 通过 | 2026-11-10 |
| 1.3 | 准备一个已上架、已签名、带附件的技能 | 通过 | 2026-11-11 |
| 1.4 | 该技能在测试账号的授权范围内 | 通过 | 2026-11-11 |
| 1.5 | 客户端指向本地后台 | 通过 | 2026-11-11 |
| 1.6 | 客户端必须是最新构建 | 通过 | 2026-11-11 |
| 1.7 | 三张表与本地落盘文件 | 通过 | 2026-11-11 |
| 2.1 | `queryGatePolicy` 字段自检 | 通过 | 2026-11-11 |
| 2.2 | `queryEntitlementSnapshot` 首查与缓存命中 | 通过 | 2026-11-11 |
| 2.3 | `queryAssetSignature` 字段自检 | 通过 | 2026-11-11 |
| 2.4 | `reportGateAudit` 首次/重复/非法事件 | 通过 | 2026-11-11 |
| 2.5 | `resignSkills` 成功路径与四类拒绝分支 | 通过 | 2026-11-11 |
| 用例1 | 主闸门关闭 → 不校验、未授权可安装、无审计 | 通过 | 2026-11-11 |
| 用例2 | 主闸门开启 + 授权命中 → 正常使用 | 通过 | 2026-11-11 |
| 用例3 | 主闸门开启 + 未授权 → 安装/启用被拒、列表不展示 | 通过 | 2026-11-11 |
| 用例4 | 验签开启 → 安装成功且清单含签名块 | 通过 | 2026-11-11 |
| 用例5 | 本地改一个字节 → 启用被拒 `manifest-mismatch` | 通过 | 2026-11-11 |
| 用例6 | 关闭验签期间安装 → 重开后 `signature-missing` | 通过 | 2026-11-11 |
| 用例7 | 撤权自动失效 / 恢复自动还原 | 通过 | 2026-11-11 |
| 用例9 | 未授权资产卸载（单条 + 批量）始终放行 | 通过 | 2026-11-11 |
| 用例10 | 关键写操作审计 `event_type=write` 落库 | 通过 | 2026-11-11 |
| 用例11 | 补签接口四种情形（本轮补测 3 条正常批量） | 通过 | 2026-11-11 |
| 用例12 | 未授权状态下真实 agent 调用 `skill` 工具被拒 | 通过 | 2026-11-12 |
| 用例13 | 已启用后被篡改，真实调用被拒（`integrity-broken`） | 通过 | 2026-11-12 |
| 用例14 | MCP 连接器握手、凭据落盘与工具调用 | 通过 | 2026-11-12 |
| 用例15 | 专家/专家团/连接器三市场页切屏不触发请求 | 通过 | 2026-11-12 |
| 4.1 | 审计上报入库字段与聚合口径 | 通过 | 2026-11-11 |
| 4.2 | 重复上报表现（沿用 2.4） | 通过 | 2026-11-11 |
| 4.3 | 客户端 spool 位置与状态 | 通过 | 2026-11-11 |

> 用例 8「快照过期 / 后台不可达」记为**不可复现**：有缓存策略时的降级行为已实测通过（按缓存放行、不报 `denied-policy-unavailable`）；「从未成功拉取策略」需要在后台停着时冷启动客户端，而客户端登录依赖后台，会卡在登录环节，因此本机无法复现；`staleAt` 过期与离线 24 小时需要改本机时间，未覆盖。

> 2026-11-11：上报 `clientId` 口径由设备 UUID 改为 `server.appId`，1.4、1.5 已按新构建复测通过；1.6 首次复测因后台落库签名与 `2026a` 公钥不配对失败，后台重新保存附件触发重签（`signed_at=20:22:38`）后复测通过。

> 2026-11-12：新增用例 12、13，用真实 agent 对话补测调用期拒绝（未授权 `gate/denied-not-entitled`、篡改 `gate/denied-integrity-broken`），均通过；用例 3 里“`call_skill` 层未实测”的缺口已关闭。

> 2026-11-12（MCP）：新增用例 14、15，覆盖连接器握手/凭据/工具调用与三个市场页切屏不取数；这两条属连接器链路，与技能闸门共用授权快照。

---

## 一、前置准备

### 1.1 后台启动与 classpath 私钥告警（预期行为）

> 状态：通过（2026-11-10）

本地 `dev` profile 把资产签名私钥放在 `resources` 下（`classpath:`），启动时会打印安全告警，这是**预期现象，不是错误**。

| 操作 | 预期日志 | 不符合时怎么判断 |
| --- | --- | --- |
| 以 dev profile 启动后台 | `【安全告警】资产签名私钥从 classpath 加载，keyId=2026a，location=classpath:...：私钥已被打进构建产物，禁止分发该 jar/war；生产环境请改为 file: 外部路径` | 没有该告警：可能私钥配成了 `file:` 外部路径（本地也可接受，但需确认 keyId 是 `2026a`），或根本没有加载私钥 |
| 同上 | `已加载资产签名私钥，keyId=2026a，source=classpath，location=...` | 出现 `加载资产签名私钥失败（当前生效密钥）`：私钥文件损坏或路径错误，验签一定失败 |
| 主闸门与验签都开启时启动 | 启动期校验通过，进程正常起来 | 出现 `IllegalStateException` 且应用起不来：见第五节「启动失败」 |
| 未配置私钥时启动 | `未配置资产签名私钥（ytsj.asset-signature.keys），暂不加载私钥` | 此时补签接口会被拒绝，验签链路无法测试；需要先按 1.3 配置密钥 |

判定依据：日志出现安全告警 = 正确；出现 `ERROR` 级别加载失败或启动异常 = 不符合。

### 1.2 策略表 `ai_asset_gate_policy`（9 行）

> 状态：通过（2026-11-10）

一行一个开关：`gate_code` 标识开关，`gate_value='1'` 开、`'0'` 关，`del_flag='0'` 为有效行。

```sql
SELECT gate_code, gate_name, gate_value, del_flag, update_time, create_time
FROM ai_asset_gate_policy
WHERE del_flag = '0'
ORDER BY gate_code;
```

预期输出（9 行，顺序按 `gate_code` 排序会不同，按内容核对）：

| gate_code | 含义 | 本期取值 | 说明 |
| --- | --- | --- | --- |
| `master` | 主闸门 | `1` | 关掉时客户端完全不判定、不验签、不上报审计 |
| `skill` | 技能子闸门 | `1` | 主闸门开时该类型才判定 |
| `mcp` | 连接器子闸门 | `1` | |
| `expert` | 专家子闸门 | `1` | |
| `expert_group` | 专家团子闸门 | `1` | |
| `model` | 模型子闸门 | `1` | |
| `knowledge` | 知识库子闸门 | `1` | 目前无客户端判定点，只下发 |
| `prompt` | 提示词子闸门 | `1` | |
| `asset_signature` | 资产验签开关 | `1` | 横向子项，不属于七类资产 |

后台读取口径（必须知道，否则测试结论会判错）：

| 情形 | 生效结果 |
| --- | --- |
| `master` 缺行 | 主闸门按关 |
| 资产类型子闸门缺行 | 该类型按关 |
| `asset_signature`：主闸门关 | 验签不生效，且完全不读该行 |
| `asset_signature`：主闸门开 + 该行缺失 | 验签按开（跟随主闸门） |
| `asset_signature`：显式 `'0'` | 验签关 |
| `asset_signature`：其他任何值 | 验签开（只有显式 `0` 才关） |
| 同一 `gate_code` 多行 | 取 `update_time` 最新（为空回退 `create_time`） |
| 策略查询异常 | 客户端按最小权限拒绝（`gate/denied-policy-unavailable`） |

预期输出校验：
- 行数必须为 9。少行时按上表兜底（例如缺 `skill` 行 = 技能闸门始终关，测试会被误判为「闸门没生效」）。
- 出现同名 `gate_code` 两行以上属脏数据，先清理再加唯一索引。

### 1.3 准备一个已上架、已签名、带附件的技能

> 状态：通过（2026-11-11）

前置条件：策略表 `master='1'` 且 `asset_signature='1'`。验签未启用时，上架与保存附件的签名环节会被整体跳过，`ai_asset_signature` 不会落行，本用例与依赖签名的用例都无法成立。

样本约束：样本技能不能与内置技能同名（当前 14 个内置技能，如 `workdsh-excel-design`）。市场安装遇到同名技能按「已安装」处理且不覆盖安装清单，用例 4/5/6 会因此误判（详见 `market-entry.ts` 的 `state:'existing'` 分支）。

| 操作 | 预期结果 | 不符合时怎么判断 |
| --- | --- | --- |
| 后台技能管理中找到/上架一个技能，确认它有**技能包附件** | 技能详情能看到附件记录 | 无附件：补签会进 `failures`，`reason` 为 `技能没有技能包附件，无法生成签名：<id>` |
| 记下该技能的 `ai_skill.id`（后续 `assetId` 全程用它） | 市场条目 id、授权快照中的 id、审计里的 `asset_id` 三处一致 | 三处不一致说明客户端/后台编号口径错乱，先修数据 |
| 触发签名：上架流程自动签，或调用补签接口（见 2.5） | `ai_asset_signature` 出现该资产的行 | 查询无行：`queryAssetSignature` 会返回「该资产尚未生成签名」，安装会被拒 |

签名落库校验：

```sql
SELECT asset_type, asset_id, key_id, payload_version, file_count, manifest_digest, signed_at, remark
FROM ai_asset_signature
WHERE asset_type = 'skill' AND asset_id = '<技能id>' AND del_flag = '0'
ORDER BY signed_at DESC;
```

预期：至少 1 行，`key_id='2026a'`，`file_count` 与签名文件数一致，`manifest_digest` 为 64 位小写十六进制。

判定依据：技能详情页存在技能包附件记录；`queryAssetSignature`（见 2.3）返回 `algo=Ed25519`、`keyId=2026a`、`fileCount=3`，`assetType=skill`、`assetId` 与请求入参一致；市场条目 id、授权快照中的 id、`queryAssetSignature` 返回的 `assetId` 三处一致。

说明：技能列表接口（`queryAuthorizedSkillList`）返回的 `skillFile` 为 `null` 属正常，附件以详情页或 `ai_skill_fjxx` 附件表为准，不要据此判断「没有附件」。

### 1.4 该技能在测试账号的授权范围内

> 状态：通过（2026-11-11，按 `clientId=server.appId` 新构建复测）

授权来源三选一即可命中：**账号**、**部门**、**角色**。本地不直接改授权表，判定方式以快照接口为准：

| 操作 | 预期结果 | 不符合时怎么判断 |
| --- | --- | --- |
| 用测试账号调用 `queryEntitlementSnapshot`（见 2.2） | `result.assets.skill` 数组包含该 `assetId` | 不包含：该账号未命中三源任一授权；此时只能测「未授权」用例 |
| 同一次返回里 `staleAt` 在未来 | 快照可用 | `staleAt` 已过：所有写操作会被拒（`gate/denied-expired`） |

授权变更后客户端需要一次快照刷新才生效：后台 `revision` 变化后，客户端最迟 60 秒重拉一次；进入市场页签、点「刷新」、安装/启停/卸载完成、窗口重新聚焦时会立即补一次校验（单飞 + 15 秒节流），因此通常无需等待。本地测试仍建议**重启客户端**，结论最稳定。

判定依据：`queryEntitlementSnapshot` 的 `result.assets.skill` 含该 `assetId`，且同一次返回的 `staleAt` 在未来；客户端市场列表能展示该技能（`visibleAssets` 放行），启用时不被 `gate/denied-not-entitled` 拒绝；审计中无 `gate/denied-expired`、`gate/denied-no-snapshot`。

### 1.5 客户端指向本地后台

> 状态：通过（2026-11-11）

修改 `workdsh-app.json`：

```json
{
  "server": {
    "baseUrl": "http://127.0.0.1:18080/ytsj-ai",
    "adminSsoUrl": "http://localhost:3100/clientSSO"
  }
}
```

闸门相关路径由载体注入，默认值已在本仓库 `app-config.ts` 的 `APP_CONFIG_DEFAULTS.server` 中维护，不需要手工改：

| 用途 | 路径 |
| --- | --- |
| 策略 | `/desktop-client/asset/queryGatePolicy` |
| 授权快照 | `/desktop-client/asset/queryEntitlementSnapshot` |
| 审计上报 | `/desktop-client/asset/reportGateAudit` |
| 安装清单签名 | `/desktop-client/asset/queryAssetSignature` |

判定依据：客户端能登录本地后台、技能市场能拉到列表，即注入生效。市场空白但后台接口正常，见第五节。

### 1.6 客户端必须是最新构建

> 状态：通过（2026-11-11，后台 20:22:38 重签后复测）

验签依赖客户端内置公钥表 `packages/asset-signature/src/public-keys.ts`，当前只有 `2026a` 一把，是近期才内置的。

| 操作 | 预期结果 | 不符合时怎么判断 |
| --- | --- | --- |
| 重新构建并启动客户端（`corepack yarn dev` 或本地安装包） | 验签用例正常通过 | 旧构建会遇到「未知 keyId」：表现是 `gate/denied-signature-missing`（缺公钥按签名缺失处理），不是 `signature-invalid` |
| 核对后台 `active-key-id` 与客户端内置 keyId 都是 `2026a` | 一致 | 不一致：所有验签都会失败，且改客户端代码才能修 |

实测记录（2026-11-11）：

- 客户端构建「最新」这一项成立：宿主 PID 4276 于 17:53:40 启动（`strict`），运行时加载的 `apps/desktop/build/workdsh-runtime/profiles/workdsh/node_modules/workdsh-asset-signature/dist/public-keys.js` 含 `2026a` 公钥；`packages/asset-signature/dist` 为 17:52 构建。
- keyId 对齐这一项成立：`queryAssetSignature` 返回 `algo=Ed25519`、`keyId=2026a`；后台 `application-dev.yml` 的 `active-key-id=2026a`。
- 首次复测（重签前）失败：`market-install` 被拒 `gate/denied-signature-invalid`（非 `denied-signature-missing`，说明客户端已找到公钥并执行了验签）。定位为后台落库签名问题：`signed_at=19:02:17` 的签名用 `keys/asset-signing-2026a.pem` 推出的公钥（base64 DER `MCowBQYDK2VwAyEAkqd3SqgQ5bcVCpsnIVAzOWhKmN46AGcCbEoUGFoIj/s=`，与客户端内置值相同）Ed25519 验签失败，本地用该私钥重签得到的签名也不同。签名包内容本身无差异（`SKILL.md` 1169 / `_meta.json` 126，sha256 与 `file_manifest` 一致）。
- 后台重新保存附件触发重签后（`signed_at=2026-11-11 20:22:38`，`manifest_digest` 未变），本机用该私钥推导公钥复算 Ed25519 为 `true`。
- 复测安装：`market-install` 返回 `{"name":"weather","state":"installed"}`；`ai_asset_operation` 落 `client_id=police-assistant / skill / install / success / 20:23:28`；`ai_asset_gate_audit` 落 `write|install|success`（20:23:31），无新增 `denied`。安装目录 `.workdsh-install.json` 的 `signature` 含 `payloadVersion/algo=Ed25519/keyId=2026a/digest`，同目录存在 `.workdsh-asset-signature.json`。

### 1.7 三张表与本地落盘文件

> 状态：通过（2026-11-11）

| 表 | 作用 | 查询语句 |
| --- | --- | --- |
| `ai_asset_gate_policy` | 闸门策略来源，下发给客户端 | 见 1.2 |
| `ai_asset_signature` | 技能安装清单签名（载荷、文件清单、签名值、keyId） | 见 1.3 |
| `ai_asset_gate_audit` | 客户端审计上报落库（只写不读，本期无查询页面） | 见第四节 |

客户端本地文件（`<home>` = 运行时 DSH 主目录；macOS 开发态为 `~/Library/Application Support/dsh-plugin-desktop/dsh-home`，打包版为 `~/Library/Application Support/警务助手/dsh-home`，可用 `WORKDSH_DSH_HOME` 覆盖）：

| 文件 | 路径 | 作用 |
| --- | --- | --- |
| 策略缓存 | `<home>/.workdsh-state/asset-gate/policy/policy.json` | 最近一次成功拉取的策略（带完整性校验） |
| 策略密钥 | `<home>/.workdsh-state/asset-gate/policy/policy.key` | 策略完整性校验密钥 |
| 授权快照 | `<home>/.workdsh-state/asset-gate/accounts/<账号标识>/<32位hash>.snapshot` | 按账号隔离、加密存储 |
| 撤权账本 | `<home>/.workdsh-state/asset-gate/accounts/<账号标识>/revocations.json` | 已撤权资产清单 |
| 审计 spool | `<home>/.workdsh-state/asset-gate/accounts/<账号标识>/audit-spool.jsonl` | 上报失败暂存，每行一条事件 |

---

## 二、后台接口自检

统一响应外壳：成功 `{"success":true,"code":200,"result":{...}}`，失败 `{"success":false,"code":500,"message":"..."}`。

### 2.1 `GET /desktop-client/asset/queryGatePolicy`

> 状态：通过（2026-11-11）

```bash
curl -s -H "X-Access-Token: $TOKEN" \
  "$BASE/desktop-client/asset/queryGatePolicy" | jq
```

| 预期字段 | 类型 | 判定 |
| --- | --- | --- |
| `result.masterEnabled` | boolean | 与表中 `master` 行一致 |
| `result.assetGates.skill/mcp/expert/expert_group/model/knowledge/prompt` | boolean | 7 个键必须齐全 |
| `result.assetGates.assetSignature` | boolean | 第 8 个键；主闸门关时恒为 `false` |
| `result.revision` | string | 策略修订号，非空；内容不变则不变 |

不符合：`assetGates` 少于 8 键 → 后台版本旧；`success=false` → 策略查询异常（日志 `查询资产闸门策略失败`）。

实测（2026-11-11 20:2x）：`masterEnabled=true`，`assetGates` 8 键齐全且全为 `true`，`revision=0ceaef760c4394fb`。说明：当前实现（`IAiClientService`）的 revision 是「固定顺序拼接开关值后 SHA-256 取前 16 位」，不是早期的 `ai-asset-gate-policy-v1|master=1|...` 明文串；客户端只当不透明版本号使用，本地 `policy/policy.json` 缓存的 revision 与之一致，不影响判定。

### 2.2 `GET /desktop-client/asset/queryEntitlementSnapshot`

> 状态：通过（2026-11-11）

```bash
curl -s -H "X-Access-Token: $TOKEN" \
  "$BASE/desktop-client/asset/queryEntitlementSnapshot" | jq
# 命中缓存时只返回修订号：
curl -s -H "X-Access-Token: $TOKEN" \
  "$BASE/desktop-client/asset/queryEntitlementSnapshot?revision=<上一步的 revision>" | jq
```

| 预期字段 | 判定 |
| --- | --- |
| `result.revision` | 非空；与策略 `revision` 是不同维度，不要混用 |
| `result.unchanged` | 首次查询为 `false`；带相同 `revision` 再查为 `true` 且不带明细，同时返回 `staleAt`（实测 `{"revision":"139941dd9b255e4d","unchanged":true,"staleAt":"2026-11-11 23:59:59"}`） |
| `result.staleAt` | 快照失效时间；已过期时客户端所有判定都会拒绝 |
| `result.generatedAt` | 生成时间 |
| `result.assets.skill`（及另外六类） | 字符串 id 数组，命中授权的 `assetId` 必须出现在这里 |

不符合：`success=false` + `未获取到登录用户信息！` = token 无效；`查询资产授权快照失败！` = 后台查库异常（客户端按 fail-closed 处理，属预期防御）。

### 2.3 `GET /desktop-client/asset/queryAssetSignature?assetType=skill&assetId=…`

> 状态：通过（2026-11-11）

```bash
curl -s -H "X-Access-Token: $TOKEN" \
  "$BASE/desktop-client/asset/queryAssetSignature?assetType=skill&assetId=<技能id>" | jq
```

| 预期字段 | 判定 |
| --- | --- |
| `result.assetType` / `result.assetId` | 与请求一致；`assetId` 必须等于市场条目 id |
| `result.payloadVersion` | 形如 `workdsh-asset-signature-v1` |
| `result.algo` | `Ed25519` |
| `result.keyId` | `2026a`（与客户端内置公钥一致） |
| `result.digest` | 64 位小写十六进制 |
| `result.signature` | base64（原始 64 字节） |
| `result.fileCount` / `result.files` | `fileCount` 等于 `files` 长度；`files` 顺序即签名顺序 |
| `result.signedAt` | 签名时间 |

不符合：`success=false` + 「该资产尚未生成签名」→ 先补签；「资产不存在」→ `assetId` 传错。

### 2.4 `POST /desktop-client/asset/reportGateAudit`

> 状态：通过（2026-11-11）

```bash
EID=$(uuidgen)
curl -s -X POST \
  -H "X-Access-Token: $TOKEN" -H "Content-Type: application/json" \
  -d "{\"clientVersion\":\"local-test\",\"events\":[{\"eventId\":\"$EID\",\"eventType\":\"write\",\"layer\":\"write_action\",\"action\":\"install\",\"resultCode\":\"success\",\"assetType\":\"skill\",\"assetId\":\"<技能id>\",\"assetName\":\"测试技能\",\"repeatCount\":1,\"clientTime\":\"2026-11-09 10:00:00\"}]}" \
  "$BASE/desktop-client/asset/reportGateAudit" | jq
```

| 预期字段 | 判定 |
| --- | --- |
| `result.accepted` | 首次上报为 `1` |
| `result.duplicated` | 首次为 `0` |
| `result.failed` | `0`；非 0 时 `failedEventIds` 给出 id |
| `result.invalid` | `0`；非 0 时 `invalidEvents[]` 给出 `{eventId, reason}` |
| `result.serverTime` | 服务端时间 |
| `result.duplicateEventIds` / `failedEventIds` / `invalidEvents` | 首次为空数组 |

用同一个 `eventId` 再发一次：`duplicated=1`、`duplicateEventIds` 含该 id，库里仍然只有 1 行（`event_id` 唯一）。

不符合：`未获取到登录用户信息！` = token 失效；`上报资产闸门审计失败！` = 后台异常；`invalid` 非空 = 缺少 `eventId`/`eventType`/`layer`/`resultCode` 或字段超长（这四项必填且校验枚举）。

### 2.5 `POST /signature/aiAssetSignature/resignSkills`

> 状态：通过（2026-11-11，测试期已临时移除 `@RequiresPermissions`，**上线前必须恢复权限控制**）

```bash
curl -s -X POST \
  -H "X-Access-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"skillIds":["<技能id>"],"remark":"local-test"}' \
  "$BASE/signature/aiAssetSignature/resignSkills" | jq
```

| 预期字段 | 判定 |
| --- | --- |
| `result.total` | 去重后的条数 |
| `result.signed` | 成功条数 |
| `result.failed` | 失败条数 |
| `result.failedIds` | 失败 id 数组 |
| `result.failures[]` | 元素 `{skillId, reason}`，`reason` 为具体异常文案 |

拒绝口径：

| 请求 | 预期响应 |
| --- | --- |
| 验签未启用（主闸门关或 `asset_signature` 关） | `success=false`，`验签未启用（主闸门关闭或 asset_signature 子闸门关闭），无需补签，已拒绝执行` |
| `skillIds` 为空 | `success=false`，`skillIds不能为空！` |
| 去重后超过 200 条 | `success=false`，`单次补签不能超过200条，本次去重后共N条，请分批调用` |
| 账号无 `signature:ai_asset_signature:edit` 权限 | 无权限错误（403/鉴权失败） |

实测（2026-11-11 20:35）：

- 成功路径：`skillIds=["2120326372515352577","2120326372515352577"]` → `{"total":1,"signed":1,"failed":0,"failedIds":[],"failures":[]}`（重复 id 已去重），行 `signed_at=20:35:28`，本机用 `asset-signing-2026a.pem` 推公钥复算 `digest` 一致、Ed25519 = `true`。
- 空 `skillIds` → `skillIds不能为空！`；201 条 → `单次补签不能超过200条，本次去重后共201条，请分批调用`；不存在的 id → `total=1,signed=0,failed=1,failedIds=["9999999999999999999"]，reason=技能不存在，无法生成签名：…`。
- 验签未启用：临时把 `ai_asset_gate_policy.asset_signature` 置 `0`（策略 revision 变为 `a42af65d6a9e7a2a`、`assetGates.assetSignature=false`）后调用 → `验签未启用（主闸门关闭或 asset_signature 子闸门关闭），无需补签，已拒绝执行`；随后已改回 `1`，revision 恢复 `0ceaef760c4394fb`、`assetSignature=true`。
- 权限：当前运行的后台是 `~/projects/yt-jwai3.9.6`（端口 18080，20:28 启动），该工程把 `@RequiresPermissions("signature:ai_asset_signature:edit")` 临时去掉后接口才可调用；`ytsj-ai` 工程源码里注解仍在。**上线前需恢复注解/权限**。

---

## 三、客户端链路测试用例

每条的「判定依据」= 界面表现 + 数据库/本地文件证据，二者必须同时满足才算通过。改策略后统一**重启客户端**再测，避免等轮询（主闸门关时策略 10 分钟一轮；开闸后策略与快照均 60 秒一轮，且进入市场页/点刷新/窗口聚焦会立即补一次校验）。

### 用例 1：主闸门关闭 → 不校验，未授权资产可用

> 状态：通过（2026-11-11）。样本：`查询天气`（`2120326372515352577`，该账号已撤权，不在快照 `assets.skill` 中）。

| 项 | 内容 |
| --- | --- |
| 前置条件 | `master` 行缺失或 `gate_value='0'`；`skill` 可任意；测试技能**不在**授权快照中 |
| 操作步骤 | 1）改表后重启客户端；2）打开技能市场；3）安装该未授权技能；4）启用并调用一次 |
| 预期结果 | 市场列表不做授权过滤，条目可见；安装成功（清单不含 `signature`）；启用成功；调用成功；不产生任何审计事件 |
| 判定依据 | 界面：无「未授权/已失效」标签，安装与启用均成功。数据：`.workdsh-install.json` 中无 `signature` 字段；无 `.workdsh-asset-signature.json`；`ai_asset_gate_audit` 无新增行（主闸门关闭时上报器已停止，事件被静默丢弃） |

不符合：出现 `denied-*` 审计行 → 主闸门其实没关（查 1.2 的读取口径）；仍要求验签 → `signatureEnabled()` 判定未跟随主闸门，属实现缺陷。

实测记录（2026-11-11 20:43–20:50）：

- 策略：`master` 改 `'0'` 后在下一轮轮询（20:44:20）生效，本地 `policy/policy.json` 为 `{"masterEnabled":false,...,"assetSignature":false,"revision":"2f2576f84e60e826"}`（主闸门关 → `assetSignature` 跟随为 `false`）；测完已把 `master` 改回 `'1'`，后台 `queryGatePolicy` 的 revision 复原为 `0ceaef760c4394fb`。
- 安装：`market-install` 返回 `{"name":"weather","state":"installed"}`（该技能此刻不在授权快照中）；`.workdsh-install.json` 只有 `digest`/`files`，**无 `signature` 字段**；安装目录内无 `.workdsh-asset-signature.json`。
- 启停：`set-enabled(false)` → `disabled`、`set-enabled(true)` → `enabled` 均成功；`list` 中该技能 `state=enabled`、`modelInvocable=true`。
- 审计：`ai_asset_gate_audit` 无新增（安装/启用前后最新一行仍是 20:42:43.858 的卸载写审计；基线 20:42:20.846 之后没有 `denied-*`）。注意 `ai_asset_operation` 仍落了一条 `police-assistant|skill|install|success|20:48:40`——操作上报不受主闸门控制，与审计上报是两条链路。
- 边界发现（与文档原预期有差异）：后台 `queryAuthorizedSkillList` 已按 `status=上架 AND (is_public=1 OR id IN 授权集)` 过滤，所以**非公开 + 未授权**的资产在客户端市场里根本不会出现，"列表不做授权过滤"只能在公开资产上观察到。为让该未授权样本可安装，临时把该技能的 `is_public` 由 `0` 改为 `1`（仅影响后台列表可见性，不涉及授权表），测完需还原为 `0`。

### 用例 2：主闸门开启 + 授权命中 → 正常使用

> 状态：通过（2026-11-11）。样本：「查询天气」临时设为公开（见用例 1 边界说明），使其进入授权快照。

| 项 | 内容 |
| --- | --- |
| 前置条件 | `master='1'`、`skill='1'`、`asset_signature='1'`；快照 `assets.skill` 含该 `assetId` |
| 操作步骤 | 1）重启客户端；2）市场安装；3）启用；4）让 agent 调用一次该技能 |
| 预期结果 | 列表可见且无异常标签；安装、启用、调用全部成功 |
| 判定依据 | 界面：正常可用。数据：清单含 `signature` 块；`ai_asset_gate_audit` 无 `denied`；有 `write/success` 的 `install`/`enable` 行 |

### 用例 3：主闸门开启 + 未授权 → 列表不展示、强行调用被拒

| 项 | 内容 |
| --- | --- |
| 前置条件 | `master='1'`、`skill='1'`；快照 `assets.skill` **不含**该 `assetId`（账号/部门/角色三源都没有） |
| 操作步骤 | 1）重启客户端并刷新市场；2）直接调用市场安装接口（绕过界面过滤，或用脚本打 `market-install`）；3）对已落盘的该技能点启用；4）让 agent 调用该技能工具 |
| 预期结果 | 列表不展示该条目；安装接口被拒；启用被拒；调用被拒。原因码统一为 `gate/denied-not-entitled` |
| 判定依据 | 界面：市场搜不到该技能；启用提示「当前账号未获得该项资产的授权。」。数据：`ai_asset_gate_audit` 出现 `event_type=denied`、`reason_code=gate/denied-not-entitled`，`layer` 分别可能为 `data_layer`（安装/启用）与 `call_skill`（调用），`action` 为 `install`/`enable` |

不符合：列表仍展示 → `visibleAssets` 过滤未生效；能启用成功 → 权限判定被绕过，属严重问题。

实测记录（2026-11-11 20:58，样本「查询天气」撤权状态）：

- 快照 `revision=39445db218d5deda`、`assets.skill` 14 条、不含该 id；后台 `queryAuthorizedSkillList` 返回 14 条、不含该技能（非公开 + 未授权被服务端过滤）。
- `market-install`（绕过界面直接打接口）→ `gate/denied-not-entitled`「当前账号未获得该项资产的授权。」；禁用后再 `set-enabled(true)` → 同样 `gate/denied-not-entitled`。
- 审计落两行：`skill|2120326372515352577|denied|data_layer|install|gate/denied-not-entitled|20:58:31.070`、`skill|null|denied|data_layer|enable|gate/denied-not-entitled|20:58:42.691`。
- 未做：`call_skill` 层的拒绝已由用例 12 在真实 agent 调用中补测通过（2026-11-12）。

### 用例 4：验签开启 → 市场安装成功且清单含签名块

> 状态：通过（2026-11-11）

| 项 | 内容 |
| --- | --- |
| 前置条件 | `master='1'`、`asset_signature='1'`；技能已签名（1.3）；客户端为最新构建 |
| 操作步骤 | 1）重启客户端；2）市场安装该技能；3）查看安装目录 |
| 预期结果 | 安装成功；清单含 `signature` 块；签名缓存文件存在；无 `denied` 审计 |
| 判定依据 | 界面：安装成功、可启用。文件：`.workdsh-install.json` 的 `signature` 含 `payloadVersion`/`algo`/`keyId`/`digest`/`signature`；同目录有 `.workdsh-asset-signature.json`；`keyId='2026a'` |

不符合：提示 `gate/denied-signature-missing` → 后台没签名或客户端没取签名；`gate/denied-signature-invalid` → 公私钥不配对。

实测记录（2026-11-11 20:56）：安装目录 `.workdsh-install.json` 的 `signature` 为 `{"payloadVersion":"workdsh-asset-signature-v1","algo":"Ed25519","keyId":"2026a","digest":"90ce24…68f5","signature":"xPompS0/…BA=="}`；同目录存在 `.workdsh-asset-signature.json`（`fileCount=2`、`files` 含 `SKILL.md`/`_meta.json` 的 size+sha256）；同批无 `denied` 审计。

### 用例 5：本地改一个字节 → 启用被拒并落审计

> 状态：通过（2026-11-11）

| 项 | 内容 |
| --- | --- |
| 前置条件 | 按用例 4 安装完成；验签开关仍为开 |
| 操作步骤 | 1）编辑安装目录内 `SKILL.md`，改动任意 1 个字节（文件名、路径不变）；2）点启用 |
| 预期结果 | 启用被拒，原因码 `gate/denied-manifest-mismatch`，提示「资产文件与签名记录不一致，内容可能被篡改，已拒绝执行。」；审计落库 |
| 判定依据 | 界面：启用失败并给出上述文案。数据：`ai_asset_gate_audit` 新行 `event_type=denied`、`layer=install_verify`、`reason_code=gate/denied-manifest-mismatch`、`action=enable`、`result_code=denied` |

不符合：能启用 → 内容比对未执行（验签关闭也要做内容比对，属缺陷）；原因码是 `signature-invalid` → 判定路径先验签后比对，需核对 `verifyInstalledIntegrity` 实现。

实测记录（2026-11-11 20:56）：给 `SKILL.md` 末尾追加 1 个 `\n`（1169→1170 字节，sha256 变化）；禁用后启用返回 `gate/denied-manifest-mismatch`「资产文件与签名记录不一致，内容可能被篡改，已拒绝执行。」；审计新增 `skill|null|denied|install_verify|enable|gate/denied-manifest-mismatch|denied|20:56:26.721`。

### 用例 6：关闭验签期间安装 → 重开后需重新安装

> 状态：通过（2026-11-11）

| 项 | 内容 |
| --- | --- |
| 前置条件 | `master='1'`、`asset_signature='0'`；此时装一个技能（清单无签名块） |
| 操作步骤 | 1）把 `asset_signature` 改为 `'1'`；2）重启客户端；3）查看技能列表；4）点启用 |
| 预期结果 | 列表显示「需重新安装」；启用被拒，原因码 `gate/denied-signature-missing`，提示「该资产安装于签名校验关闭期间，请重新安装。」 |
| 判定依据 | 界面：标签为「需重新安装」。数据：清单无 `signature` 字段；审计 `event_type=denied`、`layer=install_verify`、`reason_code=gate/denied-signature-missing`、`action=enable` |

不符合：直接放行 → 违反了「关闭期间安装的资产重开后严格拒绝」的约定；标签显示「未授权」→ `authStateOf` 的 `reinstall` 分支未生效。

实测记录（2026-11-11 21:03–21:06）：`asset_signature` 置 `'0'`（原值 `'1'`）后等策略生效（`policy.json` 的 `assetSignature=false`、`revision=a42af65d6a9e7a2a`），重装该技能，`.workdsh-install.json` 无 `signature` 字段；把 `asset_signature` 改回 `'1'`（策略复原 `revision=0ceaef760c4394fb`）后启用返回 `gate/denied-signature-missing`「该资产安装于签名校验关闭期间，请重新安装。」；`list` 中该技能 `authState=reinstall`、`authReason` 同文案；审计新增 `skill|null|denied|install_verify|enable|gate/denied-signature-missing|denied|21:06:15.423`。

### 用例 7：撤权 → 自动停用并记审计；恢复 → 自动恢复

> 状态：通过（2026-11-11；测试手段为把样本技能 `is_public` 在 1/0 之间切换，等效于「授权/撤权」对快照的影响）

| 项 | 内容 |
| --- | --- |
| 前置条件 | 已安装且已授权；`master='1'`、`skill='1'`；快照里含该 `assetId` |
| 操作步骤 | 1）后台移除该账号/部门/角色的授权，使快照不再包含该 `assetId`；2）等快照刷新（`revision` 变化后最迟 60 秒，或进入市场页/点刷新/切换窗口焦点立即触发）或重启客户端；3）看列表与调用；4）恢复授权后再观察一次 |
| 预期结果 | 技能：列表显示「已失效」，技能工具调用被拒（判定走快照，落 `gate/denied-not-entitled`）；连接器（若用 MCP 资产验证）：运行进程被停止。审计新增一条 `revocation` 层的 `gate/revoked-authorization`（只在首次标记时记）。恢复授权后：标签消失、调用恢复，审计新增 `write/restore/success`，`layer=revocation`、`remark=auto-restored` |
| 判定依据 | 界面：标签「已失效」（提示「授权已失效，该资产已被自动停用。」）；恢复后标签消失。数据：`revocations.json` 中先出现该资产、恢复后消失；审计两类事件字段如上 |

不符合：撤权后仍可调用 → 快照未刷新（先看 `queryEntitlementSnapshot` 是否已变）；恢复后仍被拒 → 账本未清除，重启客户端重算一次验证。

> 说明：技能类资产的撤权只落账本与列表标记，不搬动/删除文件；真正停进程的是连接器（`applyGateState`）。文档判定按此实现，不要按「技能文件被移走」预期。

实测记录（2026-11-11 21:01–21:03）：

- 撤权（`is_public` 1→0）后快照 `revision` 变回 `39445db218d5deda`（`assets.skill` 15→14，不含该 id）；`revocations.json` 新增 `skill.2120326372515352577 = {disabledAt: 2026-11-11T13:01:38.824Z, cause: authorization-revoked}`；`list` 返回 `authState=revoked`、`authReason=授权已失效，该资产已被自动停用。`；审计新增 `skill|2120326372515352577|denied|revocation|null|gate/revoked-authorization|denied|21:01:42.350`。
- 该行 `state` 仍为 `enabled`（文件未搬动，与上面的说明一致），撤权语义靠 `authState` 与账本表达。
- 恢复（`is_public` 0→1）后快照回到 15 条，`revocations.json` 的 skill 条目被清除（`None`），`list` 不再带 `authState`；审计新增 `skill|2120326372515352577|write|revocation|restore|-|success|21:02:44.593`，该行 `remark=auto-restored`。
- 未做：撤权期间的 `call_skill` 实际调用拒绝（同用例 3，需要 agent 真调用）。

### 用例 8：快照过期 / 后台不可达 → 降级或拒绝

> 状态：不可复现（2026-11-11）。已实测通过的部分：「后台不可达但已缓存策略与快照」——继续按缓存策略与快照判定、不报 `denied-policy-unavailable`；未覆盖原因：「从未成功拉取策略」要求客户端在后台停着时冷启动，而客户端登录依赖后台，后台停着会卡在登录环节，进不到能触发安装/启用的页面，因此该子场景在本机无法复现；「`staleAt` 已过」「离线超 24 小时」需要改本机时间，本轮未做。

| 子场景 | 操作 | 预期结果 | 判定依据 |
| --- | --- | --- | --- |
| 从未成功拉取策略 | 停掉后台（或断网），重启客户端后操作技能 | 一律拒绝，原因码 `gate/denied-policy-unavailable` | 审计/界面文案「无法获取资产闸门策略，已按最小权限拒绝，请联网后重试。」 |
| 后台不可达但已缓存策略与快照 | 停后台，重启客户端后操作 | 沿用上次策略与快照；快照仍在有效期内时按原授权结果放行 | 无新 `denied-policy-unavailable`；操作与停后台前一致 |
| 快照 `staleAt` 已过 | 把本机时间调到 `staleAt` 之后，或等后台下发过期时间 | 读/用与写全部拒绝，原因码 `gate/denied-expired` | 文案「授权已过期，请联网刷新授权后重试。」 |
| 快照未过 `staleAt`，但距上次成功拉取超过 24 小时 | 把本机时间前移超过 24 小时（`fetchedAt` 不变） | 仅写操作（安装/启用）被拒，原因码 `gate/denied-snapshot-stale`；读/用仍按快照 | 文案「离线时间过长（超过 24 小时未成功同步授权），联网后可继续操作。」 |

不符合：后台不可达却全部放行 → fail-closed 失效；过期快照仍允许写 → 新鲜期判定被跳过。

实测记录（2026-11-11 21:18–21:37，后台 18080 由用户停掉）：

- 缓存策略仍在：`policy/policy.json` 的内容为 `{"masterEnabled":true,...,"assetSignature":true,"revision":"0ceaef760c4394fb"}`（`fetchedAt=2026-11-11T13:05:45.938Z`）。
- 客户端持续尝试拉取并失败：`host-http` 日志 `21:35:14 / 21:36:14 -> GET .../asset/queryGatePolicy` 紧跟 `!! ... · 1ms`（连接失败），`queryEntitlementSnapshot?revision=39445db218d5deda` 同样失败。
- 判定仍按缓存策略与缓存快照执行，未出现 `denied-policy-unavailable`：`market-install`（未授权样本）仍返回 `gate/denied-not-entitled`；`set-enabled` 内置技能返回 `gate/denied-not-listed`。即"后台不可达但已缓存策略与快照"子场景成立。
- 把 `policy/policy.json` 临时移走后再操作，返回仍是上面两个原因码（说明运行中的客户端用内存里的策略，不会重新读盘）；已把文件移回，`sha256=0b32e489037866f65a07d53ca312afb2f7c07a99c4d56d9e9a77e82a6e4f265a` 与移走前一致。
- 因此「从未成功拉取策略」只在客户端冷启动且无缓存时才会出现，本轮没有重启客户端，未取得 `gate/denied-policy-unavailable` 实测；`staleAt` 为 `null` 时也无从构造过期场景。

### 用例 9：未授权资产卸载 → 始终允许

> 状态：通过（2026-11-11）

| 项 | 内容 |
| --- | --- |
| 前置条件 | `master='1'`、`skill='1'`；目标技能未授权或已被撤权 |
| 操作步骤 | 1）列表中对它点卸载（单条）；2）另测一次批量卸载 |
| 预期结果 | 两种方式都卸载成功，不出现授权拒绝 |
| 判定依据 | 界面：卸载成功。数据：单条卸载有一条 `write/success`、`action=uninstall`；批量卸载当前实现不产生写审计（`batch` 分支直接执行，不经 `auditedWrite`） |

不符合：卸载被拒 → 违反「卸载始终放行」；把批量卸载无审计当成缺陷前，先对照本条说明（属当前实现口径）。

实测记录（2026-11-11）：

- 批量卸载（`batch{names:["weather"],action:"uninstall"}`，撤权状态下）返回 `{"action":"uninstall","results":[{"name":"weather","ok":true,"receipt":{"state":"uninstalled",...}}]}`；20:58:45–21:00:10 窗口内审计 0 行，符合「批量卸载不产生写审计」。
- 单条卸载（撤权 + 已禁用状态下）返回 `{"name":"weather","state":"uninstalled",...}`；审计新增 `skill|null|write|write_action|uninstall|success|21:07:42.655`。

### 用例 10：关键写操作 → 审计 `event_type=write` 落库

> 状态：通过（2026-11-11）

| 操作 | 入口 | 预期审计行 |
| --- | --- | --- |
| 市场安装 | `market-install` | `write` / `write_action` / `install` / 成功 `success`，被拒则 `denied` + 原因码 |
| 上传或导入提交 | `commit-import` | `write` / `write_action` / `install` |
| 从目录安装 | `install-catalog` | `write` / `write_action` / `install` |
| 单条启用 | `set-enabled(true)` | `write` / `write_action` / `enable`；被拒为 `denied`（`layer` 视失败类型） |
| 批量启用 | `batch(enable)` | 逐条 `write`，成功 `success`、失败 `failed`；被拒条目记 `denied` |
| 恢复（回收站） | `restore` | `write` / `write_action` / `restore` |
| 单条卸载 | `uninstall` / `market-uninstall` | `write` / `write_action` / `uninstall` |
| 删除专家 / 连接器 | `experts` / `connectors` | `write` / `write_action` / `delete` |
| 批量卸载、禁用 | `batch(disable/uninstall)` | 当前实现不产生审计行 |

判定依据：`ai_asset_gate_audit` 中 `event_type='write'`，`result_code` 为 `success`/`failed`，`fail_reason` 只在失败时有值；`create_by` 应为上报账号（服务端登录身份，不是客户端传值）。

实测记录（2026-11-11，抽查表中前几类入口）：

- `write|write_action|install|success|fail=null|create_by=admin|create_xm=管理员|client_time=2026-11-11 21:06:23|server_time=21:06:24.607|repeat_count=1`
- `write|write_action|uninstall|success|fail=null|create_by=admin|21:07:42.655`
- `write|write_action|enable|success|20:56:11.321`、被拒时落 `denied`（见用例 5/6）
- 未覆盖的入口（`commit-import`/`install-catalog`/`restore`/批量启用/专家、连接器删除）本轮没有逐条触发，只核了同一 `auditedWrite` 通道的落库格式。

### 用例 11：补签接口四种情形

> 状态：通过（2026-11-11；三种拒绝分支沿用 2.5 的实测，本轮补测 3 条的正常批量）

| 子场景 | 操作 | 预期结果 |
| --- | --- | --- |
| 正常批量 | 传 3 个已上架、有附件的技能 id | `total=3`、`signed=3`、`failed=0`、`failedIds=[]`、`failures=[]`；`ai_asset_signature` 新增/更新行，`remark` 为传入值或缺省 `bulk-resign` |
| 超过 200 条 | 传 201 个（去重后）id | `success=false`，`单次补签不能超过200条，本次去重后共201条，请分批调用` |
| 验签未启用 | 先置 `master='0'` 或 `asset_signature='0'` 再调用 | `success=false`，`验签未启用（主闸门关闭或 asset_signature 子闸门关闭），无需补签，已拒绝执行` |
| 含无附件技能 | 列表里混入一个没有技能包附件的技能 | 其余仍成功；该 id 进 `failedIds`，`failures[]` 的 `reason` 为 `技能没有技能包附件，无法生成签名：<id>` |

判定依据：接口响应字段 + `ai_asset_signature` 行数变化 + 后台日志「技能安装清单批量补签开始/结束」。

实测记录（2026-11-11 21:07:55）：`resignSkills` 传 `["2120326372515352577","2120058995689046017","2120049490393743362"]`、`remark=case11-bulk` → `{"total":3,"signed":3,"failed":0,"failedIds":[],"failures":[]}`；`ai_asset_signature` 落 3 行 `key_id=2026a`、`remark=case11-bulk`、`file_count` 分别 2/1/3。201 条上限、验签未启用、含无附件技能三种拒绝分支见 2.5 的实测记录。

---

### 用例 12：未授权状态下真实 agent 调用 `skill` 工具 → 工具层被拒

> 状态：通过（2026-11-12，真实对话 + 显式工具指令）

| 项 | 内容 |
| --- | --- |
| 前置条件 | `master='1'`、`skill='1'`、`asset_signature='1'`；「查询天气」`assetId=2120326372515352577` 已安装并启用；快照 `assets.skill` 15 条含该 id。撤权方式：把 `ai_asset_auth_grant.id=2120511611804405762` 的 `del_flag` 置 `1`（原值 `0`） |
| 操作步骤 | 1）等客户端快照刷新（≤60 秒），确认技能页该技能显示「已失效」；2）发斜杠命令 `/weather 北京今天天气`；3）再发显式指令「请直接调用 skill 工具，参数 name 设为 weather」 |
| 预期结果 | 斜杠命令在注入阶段被剔除，模型不会加载技能、也不会发起工具调用；显式指令触发 `skill` 工具调用，工具层返回拒绝，原因码 `gate/denied-not-entitled` |
| 判定依据 | 界面：第 2 步无「加载技能 weather」与工具调用卡片；第 3 步工具返回原文 `Error: 当前账号未获得该项资产的授权。`。数据：审计 `call_skill_inject` 与 `call_skill` 两层都有 `denied` 行；`ai_asset_operation` 窗口内 0 行 |

不符合：第 3 步能加载技能 → 工具层授权判定被绕过；原因码不是 `denied-not-entitled` → 判定口径串了。

实测记录（2026-11-12 10:09–10:15）：

- 撤权后客户端 10:09:38 自动停用，审计 `layer=revocation`、`reason_code=gate/revoked-authorization`、`asset_id=2120326372515352577`。
- 斜杠命令（client_time 10:12:44 / 10:12:49）：无技能加载、无工具调用；审计 `call_skill_inject`、`gate/denied-not-entitled`、`tool_name=weather`、`result_code=denied`。
- 显式指令（client_time 10:14:39）：工具返回 `Error: 当前账号未获得该项资产的授权。`；审计 `id=2120701787041931265`、`layer=call_skill`、`tool_name=skill`、`reason_code=gate/denied-not-entitled`、`server_time=10:14:41.193`。
- `ai_asset_operation` 在 10:09:19–10:15 窗口内 0 行（调用被拒不产生安装类记录）。

### 用例 13：已启用后被篡改 → 真实调用被拒（`gate/denied-integrity-broken`）

> 状态：通过（2026-11-12，真实对话 + 显式工具指令）

| 项 | 内容 |
| --- | --- |
| 前置条件 | 三闸门全开；「查询天气」已授权、已安装、已启用；`SKILL.md` 原 sha256 `1ca0c8d7…`、1169 字节 |
| 操作步骤 | 1）原地改 1 个字节（`#`→`@`，文件大小不变，mtime 变化）；2）发 `/weather 北京今天天气`；3）再发显式指令「请直接调用 skill 工具，参数 name 设为 weather」；4）从备份回写文件 |
| 预期结果 | 注入阶段剔除该技能；显式调用被工具层拒绝，原因码 `gate/denied-integrity-broken`，不是 `gate/denied-signature-missing` |
| 判定依据 | 界面：第 2 步无技能加载；第 3 步工具返回原文 `Error: 资产内容与安装时的记录不一致（可能已被修改），已拒绝本次调用，请重新从市场安装。`。数据：审计 `layer` 分别为 `call_skill_inject` 与 `call_skill`，`reason_code=gate/denied-integrity-broken`；`ai_asset_operation` 窗口内 0 行 |

不符合：仍能加载 → 调用期摘要校验未生效；原因是 `signature-missing` → 把「已启用后被改」误判成「装在验签关闭期」。

实测记录（2026-11-12 10:23–10:26）：

- 篡改后 sha256 `1ca0c8d7…` → `f078825e…`（大小仍 1169）；斜杠命令审计 `call_skill_inject`、`gate/denied-integrity-broken`（client_time 10:24:11、10:25:01）。
- 显式指令审计 `id=2120704401963982849`、`layer=call_skill`、`tool_name=skill`、`reason_code=gate/denied-integrity-broken`、`server_time=10:25:04.623`；工具返回原文同上。
- `ai_asset_operation` 窗口内 0 行。
- 恢复：回写备份后 sha256 回到 `1ca0c8d7…740e93`（`cmp` 一致），技能页无「需重装/未授权/已失效」，显式调用成功加载技能并返回天气，无报错。

**已知限制（设计行为，不是缺陷）**：斜杠命令或技能目录在注入阶段被剔除时，模型不会收到该技能内容，也不会发起 `skill` 工具调用；用户侧只看到「技能没生效」，没有显式的拒绝提示。要让工具层拒绝显形，需要模型实际发起调用（或用显式指令触发）。该行为由调用期「按需注册 + 注入前过滤」的设计决定，审计中以 `layer=call_skill_inject` 单独记录。

### 用例14 MCP 连接器握手、凭据落盘与工具调用

> 状态：通过（2026-11-12，客户端与本地后台实测）

| 项 | 内容 |
| --- | --- |
| 前置条件 | 主闸门与 `mcp` 子闸门开启；「全部数据库查询服务」已授权且公开（`assetId=2112794313345085442`）；后台 `ai_mcp_tool.token` 与上游 dbhub `--auth-token` 一致；四个 MCP 入口已补 `server/discover` |
| 操作步骤 | 1）客户端重连该连接器；2）观察 `server/discover`、`initialize`、`tools/list`；3）核对本地凭据与连接器定义；4）执行一次 `execute_sql_ytsj_ai` 查询 |
| 预期结果 | 三个方法均 200；`tools/list` 返回 1 个工具；`.credentials.yaml` 有 `Authorization` 且定义含 `authorizationCredentialRef`；工具可正常返回结果 |
| 判定依据 | 见下方实测记录 |

实测记录（2026-11-12 16:09:55）：

- `server/discover` 200（12ms），`serverInfo=ytsj-dbhub-mcp 1.0.0`、`protocolVersion=2025-03-26`；
- `initialize` 200（6ms），协商 `2025-11-25`；`notifications/initialized` 202；
- `GET`（SSE 可选流）405、`Allow: POST, DELETE`，客户端未中断；
- `tools/list` 200（71ms），仅 `execute_sql_ytsj_ai`；
- 凭据：`.credentials.yaml` 中 `WORKDSH_CONNECTOR_SHU_JU_KU_CHA_XUN_FU_WU_AUTHORIZATION` 有值（`Bearer ***`），连接器定义 `authorizationCredentialRef` 指向它；
- 工具调用：`execute_sql_ytsj_ai` 在客户端实际执行成功（用户实测；本轮只读复核到 `tools/list` 返回该工具）；
- 初始化日志无 `server/discover` 相关 WARN 或失败记录。

不符合：`tools/list` 503 且内层 401 → 先核对 `ai_mcp_tool.token` 与上游 `--auth-token` 是否逐字节一致，再看凭据是否写入。

### 用例15 专家/专家团/连接器三市场页切屏不触发请求

> 状态：通过（2026-11-12，构建产物核对 + host-http 时间窗）

| 项 | 内容 |
| --- | --- |
| 前置条件 | 客户端为 2026-11-12 16:25 构建；三个市场页各进入一次完成首屏加载 |
| 操作步骤 | 1）依次进入专家、专家团、连接器市场；2）切走再切回，不做刷新、不改筛选；3）核对 host-http 日志 |
| 预期结果 | 切屏期间不新增市场类请求；只有进入页面/切页签、切换筛选搜索、点刷新才取数 |
| 判定依据 | 运行时产物中 `ExpertsPanel.js`、`RemoteExperts.js`、`ConnectorsPanel.js` 的 `visibilitychange` 与 `focus` 监听计数均为 0；host-http 中 16:09:53（连接器市场列表）至 16:11:41 之间无任何市场类请求，期间只有 60 秒一次的 `queryGatePolicy`/`queryEntitlementSnapshot` |

不符合：切屏后又出现 `queryAuthorizedMcpToolList`、`queryAuthorizedExpertList` 等同参数请求 → 检查是否有残留 `focus`/`visibilitychange` 监听或路由层重挂载。

## 四、审计验证

### 4.1 确认上报真的入库

> 状态：通过（2026-11-11，直接查询核对了字段与聚合口径）

```sql
SELECT event_id, event_type, layer, reason_code, action, result_code, fail_reason,
       asset_type, asset_id, asset_name, tool_name,
       repeat_count, create_by, create_xm, client_time, server_time, client_version, remark
FROM ai_asset_gate_audit
WHERE del_flag = '0'
ORDER BY server_time DESC
LIMIT 30;
```

按原因码聚合（快速确认拒绝类型）：

```sql
SELECT reason_code, layer, event_type, COUNT(*) AS rows_count, SUM(repeat_count) AS events_count
FROM ai_asset_gate_audit
WHERE del_flag = '0' AND server_time >= NOW() - INTERVAL 10 MINUTE
GROUP BY reason_code, layer, event_type
ORDER BY rows_count DESC;
```

| 关键字段 | 取值/含义 | 判定要点 |
| --- | --- | --- |
| `event_id` | 客户端生成的 UUID | 唯一；同一事件重复上报不会产生第二行 |
| `event_type` | `denied` / `write` | 拒绝与关键写操作分开 |
| `layer` | `install_verify` / `data_layer` / `revocation` / `write_action` / `call_skill` / `call_tool` / `call_model` / `call_expert` | 验签类拒绝必须是 `install_verify` |
| `reason_code` | `gate/*` | 后台只校验长度，非 `gate/` 前缀会原样入库并在 `remark` 标 `unexpected-reason-code` |
| `result_code` | `denied` / `success` / `failed` | `write` 事件不应为 `denied` |
| `repeat_count` | 默认 1，聚合后 >1 | 同一资产同一原因同一层，60 秒窗口内合并（只合并尚未发出的重复事件） |
| `create_by` | 服务端登录账号（警号/身份证号） | 客户端传的账号字段被忽略；为空说明取身份失败 |
| `server_time` | 服务端接收时间 | 统计与排查以它为准；`client_time` 只用于看乱序 |

### 4.2 重复上报的表现

> 状态：通过（2026-11-11，重复上报的接口行为沿用 2.4 实测；本轮核对表中无重复行）

| 步骤 | 预期 |
| --- | --- |
| 同一 `eventId` 上报两次 | 第二次返回 `duplicated=1`、`duplicateEventIds` 含该 id；接口 `success=true`；表中仍 1 行 |
| 观察到 `failed` 非 0 | `failedEventIds` 给出 id；客户端会保留这批重试，不是数据丢失 |
| 观察到 `invalid` 非 0 | 客户端丢弃并打 warn；`invalidEvents[].reason` 说明缺哪个必填字段 |

### 4.3 客户端 spool

> 状态：通过（2026-11-11，路径与空文件状态已核对；未制造上报失败来验证积压/消费）

| 项 | 内容 |
| --- | --- |
| 位置 | `<home>/.workdsh-state/asset-gate/accounts/<账号标识>/audit-spool.jsonl`，每行一条事件 JSON |
| 写入时机 | 整单上报失败（未登录 401、网络不可达、请求被后台整单拒绝）时整批落盘 |
| 上限 | 500 条，超出丢最旧并告警 |
| 消费时机 | 开闸启动、下次登录后补发；`accepted`/`duplicated` 删除，`failed` 保留重试，`invalid` 丢弃并告警 |
| 触发节奏 | 3 秒或攒够 20 条触发一次，单批上限 100 条 |

判定：审计不上报时先看 spool 是否积压（文件非空且持续增长 = 一直发不出去，结合第五节排查）。

---

## 五、失败排查对照表

| 现象 | 最可能原因 | 处理方式 |
| --- | --- | --- |
| 后台启动失败，异常 `IllegalStateException` | 需要验签但 `ytsj.asset-signature.keys` 为空 / `active-key-id` 为空 / `active-key-id` 不在 `keys` / 私钥读不出 | 按异常文案里的 `keyId` 与 `location` 修配置；只需要先跑通不验签的用例时，把主闸门或 `asset_signature` 关掉启动 |
| 启动成功但签名调用报「未找到 keyId 对应的私钥配置」 | `active-key-id` 与 `keys` 的键不一致 | 两处改成同一个 keyId（当前 `2026a`） |
| 安装提示 `gate/denied-signature-invalid` | 客户端内置公钥与后台私钥不是一对 | 核对客户端构建是否含 `2026a` 公钥、后台是否用同一对密钥；轮换期间保持 keyId 与公钥表一致 |
| 安装提示 `gate/denied-signature-missing`，但后台明明签过 | 客户端 keyId 表里没有该 keyId（旧构建），或后台签名未生成 | 重新构建客户端；`queryAssetSignature` 确认 `keyId` 与 `signedAt` |
| 提示 `gate/denied-signature-asset-mismatch` | 签名载荷里的 `assetId` 与市场条目 id 不一致（技能包被替换、id 变更后未补签） | 对当前 `ai_skill.id` 重新补签，再重装 |
| 提示 `gate/denied-manifest-mismatch` | 文件内容 sha256 与签名载荷不一致（含文件缺失） | 重装；确认没人改过安装目录；确认客户端版本会按规范化路径排序重建载荷 |
| 改了文件 `mtime` 就报不符 | 不应发生：校验只看 sha256 与文件集合，`mtime` 不参与 | 若确实因 `mtime` 报错，属实现缺陷，记录复现步骤提缺陷 |
| 提示 `gate/denied-manifest-extra-file` | 安装目录里多了签名之外的文件（含临时文件、编辑器备份文件） | 清掉多余文件后重试；确认不是安装过程中残留 |
| 市场列表空白或少了条目 | 未授权被 `visibleAssets` 过滤；或快照为空；或策略 fail-closed | 查 `queryEntitlementSnapshot` 是否含该 id；查审计是否有 `gate/denied-no-snapshot` / `denied-policy-unavailable` |
| 市场接口正常但列表为空，且无任何审计 | 主闸门关闭时不做过滤也不上报，列表应全量 | 若列表仍为空，问题在市场接口或登录态，不在闸门 |
| 启用被拒但原因码是 `gate/denied-not-entitled`，而授权明明配了 | 授权改了但快照未刷新，或客户端当前账号/部门与配置不一致 | 重启客户端；比对快照接口返回；核对三源是否配到了别的账号/部门 |
| 审计一条都没有 | 未登录（上报 401）、`report` 接口整体失败、主闸门关闭（不产生事件）、spool 积压 | 看 spool 文件与客户端日志；用 2.4 直接 curl 验证接口；确认主闸门状态 |
| 审计有重复行 | `event_id` 没带或每次都随机生成新值 | 检查客户端事件构造；确认后台 `event_id` 唯一索引存在 |
| `create_by` 为空 | 服务端未取到登录身份 | 检查 `X-Access-Token` 是否有效；审计身份只认服务端登录态 |
| 补签返回 `验签未启用…` | 主闸门关或 `asset_signature` 关 | 先开闸再补签；或确认是否本就需要补签 |
| 补签部分失败 | 技能没有技能包附件、附件读不出、技能不存在 | 看 `failures[].reason`，按条修复后重试 |

---

## 六、本期不在测试范围

以下能力**本期未实现（或未启用），不纳入测试**，不要为它们提缺陷：

| 项目 | 状态 |
| --- | --- |
| 审计查询页面（后台按条件检索/导出 `ai_asset_gate_audit`） | 本期未实现，只有上报写入；验证走 SQL |
| 策略维护页面（管理员可视化改 `ai_asset_gate_policy`） | 本期未实现，策略靠直接改表/初始化脚本 |
| 归档表与归档定时任务（`ai_asset_gate_audit` 归档） | 本期未实现、任务未注册；审计只写不归档，表会持续增长 |
| MCP 工具级授权（按单个工具而非连接器授权） | 本期未实现 |
| Web 端闸门链路 | 本期不纳入 |
| 提示词数据层 | 本期未实现 |
| 非技能类资产的配置签名（连接器/专家/模型/知识库/提示词的签名） | 本期未实现，`ai_asset_signature` 只有 `skill` |
| 存量技能补签入口（页面化/批量全量） | 本期只有显式 `skillIds` 的补签接口，无「全部上架技能」一键入口 |
| 密钥轮换工具 | 本期未实现，按手工流程替换配置 |
