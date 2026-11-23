# 在线升级改造方案（可靠性 + 体验与运营）

状态：**方案待评审，未开始实施**；第一步（下载可靠性 + 本地包复用）的实施设计已记录在 4.10，暂不实施。

范围：WorkDSH Desktop 现有自研更新链路（`apps/desktop/src/update-*.ts` 与 `workdsh-main.ts` 的更新部分）。

已确认的产品决策：

- 静默预下载：**始终自动**（检查到新版本即排队下载，可配置关闭）。
- 错峰：按 `clientId` 随机延迟 **0–10 分钟**再开始下载。
- 提示时机：**下载并校验完成后**才出现可操作的“新版本已下载，重启升级”；下载过程中不出现可点击的升级入口。
- 启动异常：**提示 + 手动回退**，不做自动回退重装。
- 安装包复用：**已下载且校验通过的安装包，在安装失败后保留**；用户重试直接复用，只有文件缺失或校验失败才重新下载。
- 后台：本轮接入**升级上报**；`Range` 断点续传先按“服务端支持则续传、不支持则自动降级”实现，待有 MinIO 环境再实测。

非目标（本轮不做）：Linux 在线升级、Windows arm64、自动回退重装、安装包代码签名校验、ETag/304、更新窗口 UI 重构、文件覆盖提速（后台上传的是 `setup.exe`，payload/目录换位方案暂不采用，见 4.9）。

---

## 1. 现状与要解决的问题

| 问题 | 现状 | 影响 |
| --- | --- | --- |
| 断点续传 | 失败即删除 `.part`，无 `Range` | 大包网络抖动后从 0 重下 |
| 自动重试 | 无；失败进入 `error` 等用户点重试 | 一次瞬时断网就升级失败 |
| 预下载 | 只有用户点“重启升级”后才下载 | 弱网下用户需长时间等待 |
| 提示时机 | `available` 阶段就出现提醒条，此时可能已开始自动下载 | 用户重复点击、以为点了没反应 |
| 手动入口反馈 | 自动下载中从账号菜单点“检查更新”，主进程忽略检查且无任何反馈 | 用户误以为按钮失效，反复点击 |
| 托盘入口 | Windows 托盘右键也有“检查更新”，与账号菜单重复 | 两处入口，Windows 上需收敛为一个 |
| 文件覆盖慢 | 安装目录实测 1.0 GB / 40,201 个文件；升级时卸载器逐文件改名、安装器再全量解压 | 每次升级阻塞约 5 分钟，慢机更久 |
| 安装失败 | Host 已停止，`returnToLogin()` 并抛错 | 用户被踢回登录页，需要重新登录 |
| 重试复用 | 安装失败后重试仍会重新下载 | 已下载的包被浪费，弱网下重复等待 |
| 进度进程 | `waitForMarker` 超时结果被忽略，仍继续退出 | 进度页没起来时应用直接消失 |
| 新版本异常 | 无健康检查、无回退入口 | 坏包只能人工重装 |
| 可观测性 | 只有本机 `update.log` | 无法统计覆盖率与失败分布 |
| 旧包清理 | `userData/updates/app/<version>` 只增不减 | 长期占用磁盘 |

---

## 2. 目标

1. 下载可续传、可自动重试，瞬时网络故障不导致升级失败。
2. 检查到更新后在后台错峰自动下载；**下载完成前不出现可操作的升级提示**。
3. 安装失败可回到工作区；新版本连续启动异常时提供手动回退入口。
4. 升级关键事件可上报，后台能统计版本分布、成功率与失败原因。
5. 不改变现有安全边界与平台门禁（Windows x64 / 已打包 macOS）。

---

## 3. 状态机改造

### 3.1 新增状态

在现有 8 个状态中增加 `scheduled`：

```
idle → checking → scheduled → downloading → verifying → ready → installing
                        ↘ available ↗
checking / downloading / verifying / installing → error（手动发起时）
```

| 状态 | 含义 | 用户可见行为 |
| --- | --- | --- |
| `scheduled` | 已发现新版本，等待错峰计时 | 无提醒条；托盘显示“新版本 x · 准备下载”；更新窗口显示倒计时与“立即下载 / 稍后” |
| `available` | 可下载但未自动开始（手动检查、自动下载被抑制、磁盘不足、自动下载失败冷却） | 提醒条可操作；更新窗口显示“立即更新 / 稍后” |
| `downloading` | 正在下载 | 只在托盘与更新窗口显示进度；**无提醒条、无“立即更新”** |
| `ready` | 下载并校验完成 | 提醒条“新版本已下载，重启升级”；更新窗口“立即重启安装 / 稍后” |

### 3.2 事件与快照扩展

`UpdateSnapshot` 增加：

```ts
readonly origin?: 'auto' | 'manual'        // 本次检查/下载来源
readonly scheduledAt?: number              // 预计开始下载的时间戳
readonly retry?: { attempt: number; of: number; delayMs: number }
readonly autoSuppressed?: boolean          // 本次运行已取消自动下载
```

`UpdateMachineEvent` 增加：

- `checked` 增加 `origin` 与 `delayMs`：自动检查且自动下载开启时进入 `scheduled`，否则进入 `available`。
- `schedule-elapsed`：由服务层计时器触发，`scheduled → downloading`。
- `download-failed` 增加 `quiet: boolean`：自动下载失败回到 `available`（保留 failure 供窗口查看），手动下载失败仍进入 `error`。
- `suppress-auto`：用户取消自动下载，回到 `available` 并记录 `autoSuppressed`。
- `retry-wait`：下载重试等待，写入 `retry`，阶段保持 `downloading`（第一步实现）。
- `reuse`：检查时发现本地安装包有效，`available → ready`，不下载（第一步实现）。
- `install-package-invalid`：安装前发现本地包缺失/损坏，`installing → downloading`，自动重下一次（第一步实现）。
- `redownload`：用户手动要求重新下载，`error` / `ready → downloading`（第一步实现，待确认是否加按钮）。

`UpdateEffect` 增加：

- `{ type: 'schedule-download'; candidate; delayMs }`：由服务层 `setTimeout` 实现，`dispose` / `cancel` / `dismiss` 时必须清除计时器。

### 3.3 关键迁移规则

| 当前 | 事件 | 结果 |
| --- | --- | --- |
| `checking` | `checked`（auto，自动下载开） | `scheduled`，`scheduledAt = now + delayMs` |
| `checking` | `checked`（manual） | `available`（手动检查不自动下载，见开放问题 1） |
| `checking` | `checked`（强制更新） | `scheduled` 且 `delayMs = 0`（强制更新不等待） |
| `scheduled` | `schedule-elapsed` | `downloading`，`origin='auto'` |
| `scheduled` | `schedule-elapsed`（已抑制/已取消） | 无变化 |
| `scheduled` | `dismiss` | `idle`，记住跳过版本 |
| `scheduled`/`downloading` | `suppress-auto` | `available`，`autoSuppressed=true` |
| `downloading` | `retry-wait` | 保持 `downloading`，写入 `retry` |
| `downloading` | `download-failed`（quiet） | `available` + failure + 冷却 30 分钟 |
| `downloading` | `download-failed`（非 quiet） | `error`（现有行为） |
| `ready` | `install` | `installing`（现有） |
| `available` / `scheduled` | `download`（本地安装包校验通过） | `ready`；若为“重启升级”意图则继续 `installing`，全程零下载 |
| `available` | `reuse`（本地安装包校验通过） | `ready`，不下载 |
| `installing` | `install-package-invalid` | `downloading`，自动重下一次后继续安装 |
| `error` / `ready` | `redownload` | `downloading`，删除本地包后完整重下 |
| `error` | 重试（本地安装包校验通过） | `installing`，不重新下载 |

`mandatoryUpdateBlocksEntry()` 需要把 `scheduled` 也纳入阻断；由于强制更新 `delayMs=0`，不会出现长时间锁在门外。

---

## 4. 客户端详细设计

### 4.1 下载：续传与重试

改动文件：`update-download.ts`、`update-service.ts`。

- `.part` 旁边保存 `.part.json`：`{ version, size, sha256, url, etag?, updatedAt }`。开始前与当前候选比对，不一致则删除两者。
- 存在 `.part` 时发送 `Range: bytes=<已下载>-`：
  - 返回 `206` 且 `Content-Range` 起点/总长匹配 → 追加写入；
  - 返回 `200` → 服务端不支持或文件已变，清空 `.part` 从 0 写入；
  - 返回 `416` → 删除 `.part` 重试一次完整下载。
- 无论是否续传，最终仍校验总大小与 sha256（现有逻辑不变）。
- 磁盘检查按“剩余字节 + 256 MiB 预留”计算，不再按整包大小。
- 重试放在服务层，下载器保持单次尝试：

| 失败类型 | 重试策略 |
| --- | --- |
| `network` / `timeout` / `http-status`(5xx,408,429) | 最多 3 次，退避 2s / 5s / 10s，带续传 |
| `size-mismatch` / `hash-mismatch` | 删除 `.part` 后整包重下 1 次，仍失败则终止 |
| `disk-insufficient` | 不自动重试，回到 `available` |
| `cancelled` | 不重试，记录本次运行抑制 |
| 4xx（非 408/429） | 不自动重试 |

- 重试等待期间快照带 `retry`，更新窗口显示“网络不稳定，N 秒后重试（2/3）”；等待可被取消打断。

#### 4.1.1 本地安装包复用

- 下载前先检查 `installerPathFor(downloadDirectory, version, platform)`：文件存在、大小匹配、sidecar `<installer>.json` 记录的 sha256 与候选一致，且文件校验通过，则**跳过网络请求**，直接进入 `ready`。
- sidecar 记录 `{ version, size, sha256, mtimeMs, verifiedAt }`；存在且 mtime 未变时直接信任，缺失或 mtime 变化时流式重算一次哈希并补写；候选 sha256 变化或版本切换时删除安装包与 sidecar。
- **检查完成时也先复用**：本地包有效则通过 `reuse` 事件直接进入 `ready`，避免重启后再次显示“可下载”。
- **安装失败不得删除安装包**：`discard()` 只在版本切换、候选变化或用户主动清理时调用，`error` 状态必须保留本地包。
- 用户点“重试”：本地包有效则直接 `installing`，不再下载；文件缺失或哈希不符才走完整下载。
- 安装前发现本地包缺失/损坏时，自动删除并完整重下一次后继续安装，只兜底一次（详见 4.10）。
- 连续两次安装失败且本地包哈希仍一致时，不自动重下；在错误页提供“重新下载安装包”手动入口，避免坏包死循环。

### 4.2 自动预下载与错峰

- 新增配置 `server.updateAutoDownload: boolean`（默认 `true`）与 `server.updateChannel`（默认 `stable`）。
- 自动检查命中新版本后计算延迟：`delayMs = hash(clientId + version) % 10 分钟`，保证同一客户端对同一版本稳定；强制更新为 0。
- `clientId` 为首次运行生成的随机 UUID，存 `userData/update-client-id`，检查请求作为查询参数带上（后台可忽略）。
- 下载期间只更新托盘文案与 tooltip；不显示提醒条。用户主动打开更新窗口时显示进度与“取消下载”。
- 下载完成 → `ready` → 显示提醒条与“重启升级”。
- 自动下载失败（重试用尽）→ 回到 `available`，30 分钟内不再自动重试；期间托盘 tooltip 提示“后台下载失败，点击查看”。
- 用户取消下载/稍后 → 本版本本次运行内不再自动下载（`autoSuppressed`），手动检查仍可见。

### 4.3 安装失败恢复

改动文件：`workdsh-main.ts` 的 `installUpdate`、`waitForMarker`、`stopRuntimeForUpdate`。

- Windows：`waitForMarker` 返回 `false` 时不再 `quitForUpdate()`，改为抛出 `host-stop-failed/installer-failed`，进入 `error`，保留“重试”。
- `stopRuntimeForUpdate()` 失败时中止安装，不退出应用。
- 安装失败统一走 `recoverAfterInstallFailure()`：尝试重启本机 Host 并回到工作区；失败才 `returnToLogin()`。
- 安装失败保留本地安装包；“重试”优先复用已校验的包，见 4.1.1。
- 安装前发现本地包缺失/损坏时，自动删除并完整重下一次后继续安装，只兜底一次。
- 安装开始前记录 `upgrade-pending.json`（见 4.4），成功启动后清理。

### 4.4 启动健康与手动回退

新增 `update-pending.ts`，文件 `userData/update-upgrade-pending.json`：

```json
{
  "fromVersion": "1.0.2",
  "toVersion": "1.0.3",
  "installerPath": ".../updates/app/1.0.2/setup.exe",
  "installerPlatform": "win32",
  "attempts": 1,
  "firstStartedAt": "2026-11-20T09:30:00+08:00"
}
```

- 安装交接前写入（保留上一版本安装包路径）。
- 新版本启动时 `attempts += 1`；应用连续运行 5 分钟或已进入工作台即视为启动成功：清除 pending、清理旧包、上报成功。
- `attempts >= 3`（连续两次未成功）时，启动后弹窗：
  - “回退到 1.0.2”：Windows 复用静默安装交接执行保留的上一版本安装包；macOS 恢复安装脚本保留的 `.app.backup`。
  - “继续使用当前版本”：清除 pending，不再提示。
  - “稍后处理”：保留 pending，下次启动再提示。
- 上一版本安装包保留策略：`userData/updates/app/<version>` 只保留当前与上一版本，成功启动后删除更旧目录。
- macOS 安装脚本在替换前把现有 `.app` 移到 `<target>.backup`；成功启动 5 分钟后删除，回退时恢复。

### 4.5 升级完成提示

- pending 成功清除时写入 `userData/last-upgrade.json`：`{ version, notes?, at }`。
- 升级后首次启动在提醒条位置显示“已更新到 x.y.z”，点击打开更新窗口查看更新说明；展示一次后清除。
- `update-skipped.json` 由 `{ version }` 改为 `{ version, until }`，默认跳过 7 天；自动检查在 `until` 之后重新提示，手动检查始终可见。

### 4.6 进度展示

- 下载速度与剩余时间：由服务层按最近 5 秒的增量计算，快照增加 `bytesPerSecond?` 与 `remainingSeconds?`。
- Windows 任务栏 / macOS Dock 进度：下载与安装阶段调用主窗口 `setProgressBar`，结束或失败时清除。
- 托盘 tooltip：`正在下载更新 42% · 约 3 分钟`。

### 4.7 账号菜单“检查更新”的状态联动

用户所述“设置 → 检查更新”即账号菜单中的“检查更新”行（[client.tsx](file:///Users/wangfenglin/projects/workdsh/packages/plugins/account-settings/src/client.tsx#L340-L347)）。自动预下载期间点击该行，当前只会发起一次 `workdsh://check-update` 导航，主进程因 `downloading` 阶段忽略检查，页面没有任何反馈。

**状态来源**

- 主进程在每次更新快照变化后，原子写入 `userData/update-status.json`（先写 `.tmp` 再 `rename`），字段只保留 `phase、version、percent、mandatory、updatedAt`，不包含下载地址、路径或异常。
- `runtimeEnvironment()` 增加 `WORKDSH_UPDATE_STATUS_FILE`，值为该文件绝对路径，供 Host 侧读取。
- Host 侧新增只读路由 `GET /api/workdsh-update-status`（`cache-control: no-store`）：读取并校验上述字段，文件缺失或解析失败时返回 `{ phase: 'unknown' }`。
- 账号菜单打开且 `/api/auth/me` 返回 `desktop: true` 时，每 1.5 秒轮询一次；菜单关闭立即停止。请求失败、超时或路由不存在时完全静默，按“无状态”处理，不显示任何标签。

**展示与点击规则**

| 更新阶段 | “检查更新”行 | 右侧状态标签 |
| --- | --- | --- |
| `scheduled` | 禁用 | `等待下载...` |
| `downloading` / `verifying` | 禁用 | `正在下载安装包...` |
| `installing` | 禁用 | `正在安装...` |
| `ready` | 可点击，打开更新窗口 | 可选 `待重启安装` |
| 其他阶段 | 与现状一致，导航到 `workdsh://check-update` | 无 |

- **`downloading` / `verifying` 期间“检查更新”行必须不可点击**：整行 `disabled`，不发起 `workdsh://check-update` 导航，避免重复检查或重复下载。
- 状态标签复用“刷新缓存”的样式：外层 `wd-account-cache-row`，标签 `wd-account-cache-result busy`（浅蓝底 `#e6f7ff`、边框 `#91d5ff`、文字 `#0958d9`、12px、圆角 6px），文案固定为 `正在下载安装包...`。
- 标签设置 `role="status"`、`aria-live="polite"`、`pointer-events: none`，点击标签不触发任何动作；与“刷新缓存”的结果标签不同，这里的状态标签不可点击关闭。
- 百分比不写进标签，放在 `title`（如“已下载 42%”），保持与“正在刷新...”相同的视觉密度。
- 下载结束后标签随阶段自动消失（`ready` 或 `available`），菜单保持已打开时无需刷新页面。

### 4.8 Windows 托盘菜单移除“检查更新”

- `refreshTrayMenu()` 目前只要 `updater` 存在就追加更新项（[workdsh-main.ts](file:///Users/wangfenglin/projects/workdsh/apps/desktop/src/workdsh-main.ts#L271-L292)）。改为：**Windows 不渲染该更新项**，菜单只保留“显示主界面 / 分隔线 / 退出软件”；macOS 保持现状。
- Windows 上 `trayUpdateLabel` 不再参与菜单文案；`handleUpdateState()` 仍然可以刷新菜单，但菜单中没有更新项。
- Windows 唯一的手动入口收敛为账号菜单“检查更新”；浏览器形态不显示该入口。
- 同步修正文档：`packages/plugins/account-settings/README.md` 中“与托盘菜单的检查更新是同一条路径”的描述，以及对应的 CHANGELOG。

### 4.9 文件覆盖耗时（本轮不处理）

后台发布的是 `setup.exe`，客户端拿不到独立的应用目录压缩包；预解压 + 目录换位需要额外 payload 产物与后台字段，**本轮不采用**，继续走现有 NSIS 安装流程。

已确认的瓶颈记录，供后续独立课题参考：

- 安装目录实测 `1.0 GB / 40,201 files`（`apps/desktop/build/workdsh-runtime`）。
- 退出前 `prepareProgressHelper()` 用 robocopy 把整个壳复制到 `%TEMP%`，慢机上耗时明显。
- NSIS 升级先运行旧版卸载器，`un.atomicRMDir` 会把 4 万多个文件**逐个 `Rename`** 到 `$PLUGINSDIR\old-install`。[uninstaller.nsh](file:///Users/wangfenglin/projects/workdsh/apps/desktop/node_modules/app-builder-lib/templates/nsis/uninstaller.nsh#L164-L182)
- 随后安装器再完整解压一遍新包，包含未变化的 1 GB runtime。

在“只有 exe”约束下仍可单独评估、但不纳入本轮的点：去掉 robocopy 进度壳、自定义 `customRemoveFiles` 跳过逐文件改名、调整安装器压缩方式、减少 runtime 文件数、运维杀软白名单。

### 4.10 第一步实施设计（下载可靠性 + 本地包复用，暂不实施）

范围：只做下载可靠性、本地包复用与兜底；不做 `scheduled`、自动预下载、错峰、30 分钟冷却、上报、回滚。

**文件约定**

每个版本目录 `userData/updates/app/<version>/`：

| 文件 | 作用 |
| --- | --- |
| `setup.exe` / `update.zip` | 下载完成且校验通过的安装包 |
| `<installer>.part` | 未完成的分片 |
| `<installer>.part.json` | 分片对应的 `version/size/sha256/etag/updatedAt`，防止旧分片拼新包 |
| `<installer>.json` | 完整包 sidecar：`version/size/sha256/mtimeMs/verifiedAt`，用于后续复用 |

**下载器（`update-download.ts`）**

1. 读取 `.part.json` 与当前候选比对；不一致则删除分片和元数据，从 0 开始；一致则读取 `.part` 实际大小作为续传起点。
2. 请求带 `Range: bytes=<已下载>-` 与 `Accept-Encoding: identity`。
3. 响应处理：`206` 且 `Content-Range` 起点/总长匹配 → 追加；`200` → 清空分片从 0 写；`416` → 删除分片，内部重试一次完整下载。
4. 续传时先把已有分片读一遍喂给 sha256，再继续写；最终仍校验总大小与 sha256。
5. 磁盘检查改为“剩余字节 + 256 MiB”，不再要求整包空间。
6. 成功后：`fsync` → 删除旧安装包 → `rename(.part, installer)` → 原子写 `<installer>.json` → 删除 `.part.json`。
7. 失败处理：`network/timeout` 保留分片；`cancelled`、`size/hash-mismatch`、`write-failed` 删除分片；`http-status` 结果附带 `status`，供服务层区分 5xx/408/429 与其他 4xx。

**服务层重试（`update-service.ts`）**

- 网络类失败最多重试 3 次，退避 2s / 5s / 10s，继续使用同一个分片。
- 大小或哈希不符：删除分片，整包重下 1 次；仍失败则终止。
- 4xx、磁盘不足、写盘失败不重试。
- 退避期间快照带 `retry: { attempt, of, delayMs }`；取消可以打断退避，回到 `available` 并清掉分片。
- 退避使用可取消的 `sleep`，不阻塞后续状态迁移。

**本地包复用与兜底（新增 `update-installer.ts`）**

- 校验：文件存在、大小匹配、sidecar 的 `version/size/sha256` 与候选一致。
  - sidecar 存在且 `mtimeMs` 未变 → 直接信任，不重算哈希；
  - sidecar 缺失或 mtime 变化 → 流式计算一次 sha256，匹配则补写 sidecar，不匹配则判定不可用。
- 三个复用点：
  1. 检查完成时：本地包有效 → `reuse` 事件直接进入 `ready`，不显示成“可下载”；
  2. 下载时：有效 → 零网络请求，直接 `downloaded → ready`；
  3. 安装时：先快速校验；文件被删/损坏 → 删除本地包，自动完整重下一次后继续安装，只兜底一次，再失败进入 `error`。
- 安装失败本身不删除安装包；`retry` 回到 `ready`，再次安装走本地包，零下载。
- 手动兜底：错误页“安装失败”时提供“重新下载安装包”，删除本地包后完整重下并安装（是否本期加按钮见开放问题 6）。

**状态机与界面**

- `UpdateSnapshot` 增加 `retry?`。
- 新增事件：`retry-wait`、`reuse`、`install-package-invalid`、`redownload`，迁移规则见 3.3。
- `UpdateView` 增加 `retry?`；更新窗口在下载中显示“网络不稳定，N 秒后重试（2/3）”。
- 更新窗口错误页的次要按钮在安装失败时改为“重新下载安装包”，并新增对应 IPC action。
- 不改托盘、账号菜单和安装交接逻辑。

**测试**

- 下载器：分片匹配续传、200 降级、416 重下、`Content-Range` 不匹配、网络中断保留分片、hash 失败删分片、续传后哈希正确、磁盘按剩余量判断。
- 服务层：两次失败后成功、退避顺序、4xx 不重试、取消打断退避、hash 失败整包重下一次。
- 复用：检查时本地有效直接 `ready`、下载零请求、安装失败后重试零下载、sidecar 缺失补算哈希、哈希不符自动重下、安装前文件缺失自动重下并安装、手动重新下载。
- 回归：现有 `update-service` / `update-download` 用例全部通过。

**取舍**

- 续传校验会多读一遍已下载分片；260 MB 在 SSD 上可接受，换取拼接文件可信。
- sidecar 快速信任避免每次检查重读整个安装包；安装前再做一次快速校验。
- 服务端返回 200 时自动降级为整包下载，功能不受影响。
- 30 分钟自动下载冷却与静默失败依赖第二步的自动预下载，本次不做。

---

## 5. 后台契约

### 5.1 版本查询（增量）

`GET /desktop-client/queryLatestVersionApp?appId&platform&arch&clientId&channel`

- `clientId`：匿名 UUID，仅用于错峰与后台灰度分桶，不代表用户身份。
- `channel`：默认 `stable`，后续可用于公测/内测。
- 后台可忽略两个新参数；忽略时行为与现状一致。

### 5.2 升级上报（新增）

建议路径：`/desktop-client/clientUpdate/report`，登记为 `server.updateReportPath`；`server.updateReportEnabled` 默认 `false`，后台部署完成后再开启。

单条事件：

```json
{
  "appId": "police-assistant",
  "clientId": "0b0d...",
  "platform": "win32",
  "arch": "x64",
  "fromVersion": "1.0.2",
  "toVersion": "1.0.3",
  "event": "download-failed",
  "code": "network",
  "durationMs": 18320,
  "at": "2026-11-20T09:31:12+08:00"
}
```

事件集合：

| event | 触发时机 | 附加字段 |
| --- | --- | --- |
| `check-failed` | 手动/自动检查失败 | `code` |
| `download-failed` | 重试用尽或不可重试 | `code`、`durationMs` |
| `download-cancelled` | 用户取消 | `durationMs` |
| `install-started` | 开始安装交接 | — |
| `install-failed` | 安装交接失败 | `code` |
| `upgrade-succeeded` | 新版本连续运行 5 分钟/进入工作台 | `durationMs` |
| `rollback` | 用户确认回退 | `code`（`manual`） |

客户端行为：

- 本地队列 `userData/update-report-queue.json`，最多 50 条；启动时、事件产生后、每 10 分钟尝试发送。
- 单次请求 10 秒超时；失败保留队列并退避，不阻塞升级流程。
- 关闭上报或路径不可用时完全静默，不产生用户提示。

### 5.3 Range 支持

- 客户端按 `206/200/416` 自适应；服务端支持 `Range` 即自动启用续传。
- **已实测（2026-11-23，直连 MinIO）**：S3 API 端口 `53755` 对预签名 GET 返回 `Accept-Ranges: bytes`；`Range: bytes=0-99`、`100000000-100000099`、末尾区间均返回 `206` 且 `Content-Range` 正确；越界返回 `416`；分段 `0-1023` + `1024-2047` 拼接后的 sha256 与单次 `0-2047` 完全一致。
- 测试对象：`yt-jwai/client-release/PoliceAssistant-1.0.2-x64-Setup_1793241624658.exe`，`276,499,711` 字节；ETag 带 `-53` 分片后缀，不能当内容哈希，继续使用后台返回的 sha256。
- **端口注意**：`9000` 是 MinIO Console（返回 HTML，且也会回 `206`），下载与预签名必须使用 `53755`；后台下发的 `downloadUrl` 必须指向 API 端口。
- 若后续改为 Nginx/后端代理，需确认转发 `Range` 且不压缩、不整包缓冲；否则客户端自动降级为整包下载。

---

## 6. 配置变更（`app-config.ts`）

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `server.updateAutoDownload` | boolean | `true` | 检查到新版本后自动预下载 |
| `server.updateChannel` | string | `stable` | 检查请求携带的通道 |
| `server.updateReportEnabled` | boolean | `false` | 是否发送升级上报 |
| `server.updateReportPath` | path | `/desktop-client/clientUpdate/report` | 上报端点，统一维护在 `APP_CONFIG_DEFAULTS` |

检查频率保持现有配置值，不在本方案内调整（见开放问题 2）。

---

## 7. 实施阶段

### P1 客户端可靠性（可独立交付）

- 下载续传、重试分类与退避。
- 本地安装包复用与兜底（检查、下载、安装前三个时机）；详细设计见 4.10。
- `scheduled` 状态、错峰、自动预下载、下载完成后再提示、取消抑制。
- 账号菜单“检查更新”状态联动：下载中显示 `正在下载安装包...` 且不可点击。
- Windows 托盘菜单移除“检查更新”入口。
- 安装失败恢复工作区、`waitForMarker` 失败不再退出。
- 下载失败冷却、旧包清理。

验收：断网 10 秒后自动续传完成；下载中不出现可点击升级入口；安装进程未就绪时可重试且应用仍在；取消后本次不再自动重下。

### P2 回滚与提示

- pending 文件、启动尝试计数、手动回退弹窗。
- Windows 保留上一版本安装包用于回退；macOS 保留 `.app.backup` 并支持恢复。
- 升级后首次启动提示、跳过版本过期。

验收：模拟新版本连续两次启动异常后出现回退入口；回退后版本号正确；升级成功后提示一次且不重复。

### P3 上报与后台联动

- 上报队列、端点、事件接入、开关。
- 检查请求携带 `clientId/channel`。

验收：后台能按版本、事件、失败码统计；断网期间事件在下次启动补报；关闭上报后无任何请求。

---

## 8. 测试计划

| 层 | 用例 |
| --- | --- |
| 状态机（headless） | `scheduled → downloading`；强制更新 `delay=0`；取消抑制；quiet 失败回 `available`；重试等待；回退提示阈值 |
| 下载器（mock fetch） | 206 续传、200 降级、416 重下、`Content-Range` 不匹配、hash 失败重下一次、磁盘按剩余量判断、网络中断保留分片、续传后哈希正确 |
| 服务层（fake timer） | 错峰延迟可取消；重试退避顺序；冷却 30 分钟；`dispose` 清理计时器 |
| 安装 | `waitForMarker` 超时不退出；Host 停止失败中止安装；失败后恢复工作区；安装前文件缺失自动重下并安装 |
| pending/回滚 | attempts 累加、成功清除、回退选择分支、旧包保留与清理 |
| 安装包复用 | 检查时本地有效直接 `ready`；下载零请求；安装失败后重试零下载；sidecar 缺失补算哈希；哈希不符自动重下；手动重新下载 |
| 上报 | 队列上限、离线补报、超时、开关关闭零请求 |
| 账号菜单状态 | `downloading/verifying` 行禁用并显示 `正在下载安装包...`；点击不导航；`unknown/404` 退回现状；菜单关闭后停止轮询 |
| 托盘菜单 | Windows 不渲染“检查更新”项，仅保留显示主界面与退出；macOS 保持现状；更新文案变化不影响 Windows 菜单 |
| 手工验收 | Windows 完整升级、弱网续传、强制更新、取消/稍后、坏包回退、后台报表 |

---

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 始终自动下载造成带宽集中 | 0–10 分钟错峰；可取消；`updateAutoDownload` 可按环境关闭 |
| 错峰期间用户手动检查 | 手动检查直接展示窗口，点击后立即下载（复用单飞守卫，不会二次下载） |
| 启动健康误判（用户长期停在登录页） | 以“连续运行 5 分钟”为准，不依赖是否登录；阈值可配置 |
| 回退条件不满足（旧包被删/权限不足） | 回退入口先校验安装包存在与平台匹配，否则给出重新安装指引 |
| mac 备份残留 | 成功启动 5 分钟后删除；下次升级前覆盖 |
| Range 服务端不支持 | 自动降级为整包下载，功能不受影响 |

---

## 10. 开放问题

1. **手动检查是否也自动下载**：本方案为“不自动，展示窗口等用户点击”，避免用户刚点检查就后台拉包。若希望统一自动，改一行判定即可。
2. **检查频率**：当前默认 5 分钟，注释与实现不一致（注释写 360 分钟）。是否调整为 30 分钟需与后台确认查询压力。
3. **上报路径与字段**：`/desktop-client/clientUpdate/report` 与上述字段需后台确认；确认前保持 `updateReportEnabled=false`。
4. **回退权限**：是否需要管理员口令或仅允许本机操作。
5. **状态路由归属**：`/api/workdsh-update-status` 放在账号设置插件的 Host 侧，还是独立小插件，实施前确定；两者都不改变“只读、无凭据”的约束。
6. **“重新下载安装包”按钮**：是否随第一步一起做；建议做，作为坏包的最后出口。
7. **sidecar 信任策略**：默认按 `size + mtime + 记录哈希` 快速信任，不每次重算；是否改为每次完整重算需确认。

---

## 11. 涉及文件

- 修改：`apps/desktop/src/update-state.ts`、`update-service.ts`、`update-download.ts`、`update-client.ts`、`update-view.ts`、`update-preload.ts`、`update-window.ts`、`update-toast.ts`、`update-toast-preload.ts`、`workdsh-main.ts`、`app-config.ts`（状态文件写入、托盘菜单、Host 环境变量）
- 修改：`packages/plugins/account-settings/src/client.tsx`（检查更新行状态与禁用）、`packages/plugins/account-settings/README.md`、`CHANGELOG.md`
- 新增：`apps/desktop/src/update-pending.ts`、`update-report.ts`、`update-status.ts`（状态文件原子写入）、`update-installer.ts`（安装包 sidecar 校验与复用）
- 新增：Host 侧只读路由 `/api/workdsh-update-status`（归属见开放问题 5）
- 测试：`apps/desktop/tests/update-*.spec.ts`（状态机、下载、服务、安装、配置）、账号菜单状态与托盘菜单的平台用例
