# 任务清单

## A. 闸门账本与协调器
- [x] A1 新增 `packages/plugins/asset-gate/src/revocation.ts`：`RevocationLedger`（按类型、按 assetId、`cause: 'authorization-revoked'`、原子落盘、幂等）。
- [x] A2 在 `AssetGateService` 接入账本：初始化加载、`clearAccount()` 清空、`pull()` 后调用 `reconcileRevocations()`。
- [x] A3 扩展 `AssetGateApi`：`revoked()`、`revokedAssets()`、`clearRevoked()`；`reasons.ts` 增加 `gate/revoked-authorization` 文案。
- [x] A4 协调器按 revision/账号去重；仅开闸、仅开对应子闸门、仅 market + 已安装执行；有变化才落盘并通知管理器。

## B. 三类资产
- [x] B1 技能 `manager.ts`：新增 `marketAssets()`；`setEnabled(true)`/`uninstall` 清除账本；`list()` 返回 `authState`/`authReason`。
- [x] B2 连接器 `manager.ts`/`shared.ts`：新增 `marketAssets()`；`summary.enabled` 改为有效状态；新增 `applyGateState()` 停/启进程；手动启用/删除清除账本；清单加可选 `digest` 并在 `create` 写入。
- [x] B3 专家 `experts-manager.ts` + 契约：新增 `marketAssets()`；`setAvailability('enabled')` 清除账本；列表摘要 `authState`/`authReason`，`canUse` 计入账本。

## C. 界面
- [x] C1 `SkillsPanel.tsx` + `styles.ts`：徽标、置灰开关、原因行。
- [x] C2 `MacpCard.tsx`、`McpDetailModal.tsx`、`ConnectorsPanel` + `styles.ts`：同上。
- [x] C3 `ExpertsPanel.tsx` + `styles.ts`：徽标、禁用召唤/启停、原因行。

## D. 摘要校验
- [x] D1 技能启用前：目录用 `verifyAssetManifest`，单文件用 `verifyAssetFileManifest`；不一致抛 `gate/denied-content-modified`。
- [x] D2 专家启停：清单 `digest` 对比已发布 `compositionDigest`；无 `digest` 记录「不可校验」。
- [x] D3 连接器启用：`installManifest.digest` 对比重算定义摘要；旧记录无摘要如实记录不可校验。
- [x] D4 全部校验仅在对应子闸门开启时执行。

## E. 构建期随包技能清单
- [x] E1 新增 `scripts/write-bundled-skill-manifests.mjs`（幂等，复用 `writeAssetManifest`）。
- [x] E2 覆盖 skills 6 个、experts 专家管理技能；接入两个包的 `build` 与 `pack-workdsh-profile.mjs`。
- [x] E3 定位官方 7 个 office 技能实际目录；可写则写入，只读/官方树则停止并报告可选方案。
- [x] E4 校验脚本检查产物清单存在且 `source: 'builtin'`。

## F. 验证与汇报
- [x] F1 新增 `packages/plugins/asset-gate/tests/revocation.test.mjs`，覆盖标记/恢复/手动清除/账号隔离/关闸零动作。
- [x] F2 运行 `corepack yarn build`（asset-gate 及改动包）、`corepack yarn typecheck`、相关插件测试、桌面端 `corepack yarn test`。
- [x] F3 按汇报要点输出。
