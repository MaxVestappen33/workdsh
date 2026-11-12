# 撤权治理与随包技能清单（规格）

## 1. 目标与范围

本轮在既有资产闸门（`packages/plugins/asset-gate`）之上补齐三块撤权治理，并追加一块随包内置技能的构建期清单：

1. 撤权后自动逻辑禁用、恢复后自动还原，且按账号隔离。
2. 本地列表界面标出「未授权 / 已失效」，开关置灰并显示原因。
3. 把 `packages/asset-manifest` 的摘要校验接入技能、连接器、专家/专家团的启用判定。
4. 构建期为随包内置技能写入 `source: 'builtin'` 清单。

硬约束：

- 不改数据库结构、不改 `docs/`、不提交 git、不新增后台接口。
- 闸门关闭时不读清单、不解析身份、不算摘要、不做任何标记与恢复。
- 判定只认安装清单里的 `source` 与 `assetId`，不按名字、目录成员或形态猜来源。
- 内置技能缺清单另有安排；本轮不加按名字/目录成员的兜底分支。

## 2. 已核实事实

- 技能：`packages/plugins/skills/src/services/manager.ts`。`stateRoot = agentsHome/.workdsh-state/skills`；启用/禁用 L523-550；`installManifest(name)` L622-635 读目录内清单或单文件旁挂清单。
- 连接器：`packages/plugins/connectors/src/manager.ts`。`ConnectorDefinition` 存 `installManifest`（`source` + 可选 `assetId`），无文件清单；`setEnabled` L203-213；列表 `summary()` L319-328。
- 专家：`packages/plugins/experts/src/services/experts-manager.ts`。`installManifestOf` L2448-2453；`setAvailability` L1448-1490；清单 `expertInstallManifestSchema` 含可选 `digest`（`compositionDigest`）。
- 闸门：`AssetGateService` 的 `stateDir` 在 Desktop 按账号注入（`accountAssetGateStateDirectory(home, principalId)`，`apps/desktop/src/local-runtime.ts:289`），天然按账号隔离；`pull()` L278-312 是快照落点；`applyEffective` L232-236 发 `workdsh/asset-gate/policy`。
- 原因码唯一来源：`packages/plugins/asset-gate/src/reasons.ts`，已含 `gate/denied-not-entitled`、`gate/denied-not-listed`、`gate/denied-content-modified`。
- 执行层已落地：`packages/plugins/asset-gate/src/enforcement.ts`（工具、技能消息、模型）。

## 3. 设计决策

### 3.1 撤权状态位：闸门侧按账号的独立账本

- 新增 `packages/plugins/asset-gate/src/revocation.ts`：`RevocationLedger`。
- 落盘位置：`AssetGateOptions.stateDir`（已按账号隔离）下的 `revocations.json`，明文 JSON，`0o600`，原子替换。
- 结构：`{ version: 1, accounts?: ..., entries: { skill: { [assetId]: { disabledAt, cause: 'authorization-revoked' } }, mcp: {...}, expert: {...}, expert_group: {...} } }`。
- 该状态位与各资产自身的「用户启用/停用」完全独立，不复用 `enabled` / `availability` 表达两种语义。
- 账号切换：Desktop 按账号重建运行时并换 `stateDir`，账本随之换文件；`clearAccount()` 同时清空内存账本。首次拉到该账号快照时重算一次。

### 3.2 撤权协调器

- 在 `AssetGateService` 内新增 `reconcileRevocations(record)`：
  - 首行：`if (!this.effective.masterEnabled) return;`（零动作）。
  - 仅当 `record.revision` 与上次处理的 revision 或账号键变化时才执行；相同则跳过。
  - 对 `skill`、`mcp`、`expert`、`expert_group` 四类分别处理，且仅当 `enabled(type)` 为真。
  - 通过 `ctx.reflect.get('workdshSkills' | 'workdshConnectors' | 'workdshExperts')` 取「已安装且 market + assetId」清单（新增 `marketAssets()` 方法）。
  - `revoked = 已安装 - 快照[type]`；`restored = 账本中且已回到快照`。
  - 只标记 market 来源；本地/内置永不进入账本。
  - 账本有变化时落盘，并通知对应管理器重算运行态（连接器停/启进程）。
- 调用点：`pull()` 成功保存或复用快照后、`store.load()` 复用磁盘快照后。
- 「闸门关闭」不标记、不恢复；再次开闸后由下一次快照同步按当前快照重算。

### 3.3 用户手动操作清除标记

- 技能 `setEnabled(name, true)`、`uninstall(name)` 成功后清除该技能 `assetId` 的账本项。
- 连接器 `setEnabled(id, true)`、`remove(id)`、`create` 后清除/无项。
- 专家 `setAvailability(..., 'enabled')` 后清除该专家/专家团 `assetId` 的账本项。
- 清除后，后续快照不会自动恢复该资产（账本已无项），用户手动禁用也保持禁用。

### 3.4 界面标记

- 三类资产列表摘要新增 `authState?: 'unauthorized' | 'revoked'` 与 `authReason?: string`。
  - `revoked`：账本命中，文案「授权已失效，已自动停用」。
  - `unauthorized`：闸门开启、market 资产、`decide` 拒绝且非账本命中，文案取 `decision.message`。
- 文案与原因码统一来自 `reasons.ts`；新增 `gate/revoked-authorization`（「授权已失效，已自动停用」）。
- 前端：
  - `SkillsPanel.tsx` 卡片：徽标「已失效 / 未授权」、开关 `disabled`、原因行。
  - `ConnectorsPanel` 的 `McpCard.tsx` 与 `McpDetailModal.tsx`：同上，`enabled` 展示为有效状态。
  - `ExpertsPanel.tsx` 卡片：徽标 + `usable=false` + 菜单项禁用 + 原因行。
- 新增样式仅追加到各面板 `styles.ts`。

### 3.5 摘要校验接入

- 技能（目录形态）：`connection-api.ts` 的 `requireSkillEnable` 在清单为 market 且闸门开启时，先 `verifyAssetManifest(entryDir)`：
  - `missing` → 视为无清单（按现有口径）；
  - `file-missing` / `quick-mismatch` / `digest-mismatch` → 抛 `gate/denied-content-modified`。
  - 单文件形态用 `verifyAssetFileManifest`。
- 专家/专家团：`setAvailability(enabled)` 且闸门开启时，若清单有 `digest`，与当前已发布修订的 `compositionDigest` 比较；不一致抛 `gate/denied-content-modified`。无 `digest` 视为不可校验，允许但记日志。
- 连接器：无文件清单。为其安装清单新增可选 `digest`（定义摘要：`serverName`/`transport`/`command`/`args`/`url`/`title` 的稳定序列化 sha256），在 `create` 写入；启用时若 `digest` 存在则重算比较，不一致拒绝；旧记录无 `digest` 时如实标记「无法校验」并记日志，不假装校验过。
- 所有校验仅在对应子闸门开启时执行。

### 3.6 构建期随包技能清单

- 新增脚本 `scripts/write-bundled-skill-manifests.mjs`（Node ESM，复用 `workdsh-asset-manifest` 的 `writeAssetManifest`，幂等）。
- 覆盖：
  1. `packages/plugins/skills/resources/skills/*`（6 个设计类技能）。
  2. `packages/plugins/experts/resources/skills/*`（专家管理技能）。
  3. 官方运行时 7 个 office 技能：先定位实际落地目录；若在可写装配目录，则写入；若属于官方源码/只读包内，停下来报告可选方案，不按名字推断。
- 写入内容：`assetType: 'skill'`、`source: 'builtin'`、无 `assetId`、`name` 取目录名。
- 接入：
  - `packages/plugins/skills/package.json` 与 `packages/plugins/experts/package.json` 的 `build` 前置执行。
  - `apps/desktop/scripts/pack-workdsh-profile.mjs` 在装配 Profile 前执行。
  - 校验脚本（`apps/desktop/scripts/verify-profile-release.test.mjs` 或新增校验）检查产物中存在清单且内容正确。
- 幂等：已有 `source: 'builtin'` 且摘要一致的清单不重写。

## 4. 验收

- `corepack yarn typecheck` 通过。
- asset-gate 新增 `tests/revocation.test.mjs`，连同既有 `gate.test.mjs`、`enforcement.test.mjs` 全部通过。
- skills / connectors / experts 相关测试通过。
- 桌面端 `corepack yarn test` 通过。
- 汇报：三类资产禁用位与标记位置、切号重算方式、界面改动文件、摘要校验接入点与不可校验项、构建期清单落地与验证程度、测试与 typecheck 结果。
