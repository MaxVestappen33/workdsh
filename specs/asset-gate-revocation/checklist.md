# 验收清单

- [x] 撤权账本独立于用户启用位：`RevocationLedger` 只落 `cause: 'authorization-revoked'`，不读写资产自身启用字段。
- [x] 撤权时按类型落禁用位：技能看账本 + `list()` 输出 `authState`；连接器 `summary.enabled` 走有效状态并 `applyGateState()` 停进程；专家 `canUse` 计入账本。
- [x] 不搬文件、不删文件：技能/专家只改状态位，连接器只停/启进程。
- [x] 恢复授权只恢复带标记的资产；用户手动禁用保持禁用。
- [x] 手动启用或卸载清除标记：技能 `setEnabled(true)`/`uninstall`、连接器 `setEnabled(true)`/`remove`、专家 `setAvailability('enabled')`/`uninstallRemote`/`deleteExpert`。
- [x] 账号隔离：账本落在按账号注入的 `stateDir`；`clearAccount()` 清内存并重置去重戳，切号后按当前账号重算。
- [x] 闸门关闭零动作：`reconcileRevocations()` 首行短路，不读清单、不解析身份、不算摘要。
- [x] 子闸门各自生效：`skill`/`mcp`/`expert`/`expert_group` 分别受 `enabled(type)` 控制。
- [x] 界面标记：技能/连接器/专家列表均显示「已失效」「未授权」，开关置灰并给出原因。
- [x] 原因码与文案唯一来源 `reasons.ts`，新增 `gate/revoked-authorization`。
- [x] 摘要校验接入技能目录、技能单文件、连接器定义摘要、专家组成摘要四处。
- [x] 不可校验项如实标记：连接器旧记录无 `digest`、专家无 `digest` 记录为不可校验；模型无文件清单且无启用判定，未接入。
- [x] 构建期清单：skills 6 个、experts 专家管理技能、office 7 个均写入 `source: 'builtin'` 清单，幂等。
- [x] 构建步骤接入两个包的 `build` 与桌面运行时装配脚本，产物校验断言清单存在。
- [x] 约束遵守：未改数据库、未改 `docs/`、未提交 git、未新增后台接口。
- [x] 测试与类型检查通过：asset-gate 32/32、experts 9/9、桌面端 45 文件 265 用例、`corepack yarn typecheck` 通过。
