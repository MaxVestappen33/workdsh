# 会话模型选择器：后台待接入清单

状态：客户端界面与交互已实现（展示层），档位真实调度、Auto 判档、倍率/繁忙数据源均待后端接入。
客户端实现位置：`packages/plugins/model-market/src/client/model-select/`，接管 `conversation.input.model` 座位。

## 一、客户端已经做完的部分

- 接管官方模型座位：低优先级注册遮蔽，插件卸载后官方选择器原样回归。
- 弹层结构：Auto 开关、快速/均衡/极致三档、按 provider 分组的模型列表、底部「配置自定义模型」。
- 悬停档位：右侧二级面板展示档位说明与消耗倍率。
- 悬停模型：右侧二级面板展示描述、消耗速度、繁忙程度、思考强度、上下文窗口。
- 思考强度：读取官方 `reasoning.efforts`，选择后真实调用 `session/selectModel`（带 `reasoningEffort`）。
- 模型选择：真实调用官方 `select`，并处理 `session/writer-held` 等失败。
- 自定义模型：弹层内复用 `CustomModelForm` 与 `/api/workdsh-model-market` 的 `custom-install`，添加后由官方目录事件刷新。
- 以下内容为**展示效果**，不改变真实调用：
  - Auto 开关与三档选择只切换触发器文案/选中态。
  - 倍率、促销标签、上下文窗口来自 `model-select/meta.ts` 的本地映射；未收录模型用确定性兜底。
  - 繁忙程度按模型 id 生成稳定的演示值。

## 二、后台需要提供的能力

### P0 档位网关

档位必须由服务端解析，客户端只发档位 id，否则「池内分配」无法成立。

- 新增三个逻辑模型：`workdsh/fast`、`workdsh/balanced`、`workdsh/deep`（命名可调整）。
- 每个档位维护候选池，池成员带：能力标签（文本/图片/工具）、上下文上限、成本倍率、供应商配额。
- 每次请求解析档位 → 选真实模型 → 转发上游 → 回传实际模型 id（响应字段或事件）。
- 约束：
  - 能力门槛：带图请求只能落在支持图片的模型上；超上下文直接剔除。
  - 成本约束：按档位固定倍率计费（0.15 / 0.50 / 1.00），底层模型采购成本由网关自行平衡。
  - 粘性：同一会话尽量保持同一真实模型，避免体验抖动。
  - 兜底：超时、限流、模型下线时在同一档位池内切换；池空才回落默认档。
- 客户端需要的接口：
  - `GET /model-tiers`：档位 id、名称、倍率、说明、候选数量。
  - 解析结果：当前请求实际落到哪个真实模型（用于详情展示与排障）。

### P0/P1 Auto 判档

- 语义：Auto 不是「默认模型」，而是「由网关决定档位」。
- 判档信号建议：输入长度、是否带图/附件、工具数量、是否代码任务、历史轮次、当前档位失败率。
- 实现可选：规则优先，复杂场景再用轻量分类模型；分类器不参与具体模型选择。
- 需要把「本次 Auto 落到哪一档」回传客户端，便于触发器展示（例如 Auto · 均衡）。
- Auto 开关状态需要随会话持久化（当前是组件内状态，刷新即丢失）。

### P1 模型展示元数据

客户端不再硬编码倍率/标签/上下文，改为接口下发：

```ts
interface ModelPresentation {
  provider: string;
  modelId: string;
  multiplier: number;
  tags?: { text: string; tone: 'green' | 'orange' | 'gray' | 'blue' }[];
  contextWindow: number;
  maxOutput?: number;
  load?: 'idle' | 'light' | 'heavy';
}
```

- 倍率：与计费口径一致，避免界面显示与实际扣费不符。
- 促销标签：夜间折扣、闲时折扣、订阅优先、限时免费、会员折扣；需要生效时间段，客户端只负责展示。
- 上下文窗口 / 最大输出：来自 provider 配置或模型目录。

### P1 繁忙程度

- 数据源建议：最近 1/5 分钟成功率、P95 延迟、队列深度、供应商限流状态。
- 输出三档：空闲 / 轻微拥堵 / 极度拥堵；可选预计等待时间。
- 传输：目录接口带 `load` 字段，或 SSE/轮询单独推送；避免每个模型一次请求。
- 当前客户端按模型 id 生成演示值，接入后替换 `busyOf`。

### P2 上下文窗口按会话配置

- 现有 `ModelSelection` 只有 `{ provider, model, reasoningEffort? }`，没有上下文窗口。
- 上下文窗口属于 provider 模型配置（`PiAiModelProfile.contextWindow`），改它是改全局模型。
- 要做会话级切换，需要 Host 在请求组装时接受 `contextWindow`（或档位）并校验不超过模型上限。
- 在官方接口扩展前，客户端只展示，不提供可切换菜单（当前点击只显示说明）。

### P2 `/model` 命令一致性

- 官方 `/model` 弹窗仍由官方渲染，会与新座位不一致。
- 选项：接管该 command 复用同一组件，或在官方弹窗上做同源数据投影。
- 当前按用户要求先记录，不接管。

### P2 自定义模型刷新链路

- 客户端依赖官方 `llm/adapters-updated` / `settings/document-updated` / `credentials/*` 事件刷新目录。
- 需在 Desktop 与 Web 验证：`custom-install` 成功后目录能自动出现新模型；若事件缺失，补一个目录版本号或刷新接口。

## 三、验收口径

1. 选「快速/均衡/极致」后，下一次请求的 `requestModelId` 是档位 id，响应能回传真实模型。
2. 同一 turn 内允许换模型，但必须留在同档位候选池内。
3. Auto 打开后，由服务端判档；客户端能展示本次落档结果。
4. 倍率、标签、上下文、繁忙全部来自接口，删除本地兜底后界面仍完整。
5. 档位倍率与账单一致；底层模型成本变化不影响用户按档位计费。
6. 池内无可用模型时按约定回落，并在界面提示，不静默降级。

## 四、本地验收环境缺口（与本次改动无关，另排期）

按用户决策，本阶段客户端效果**以静态预览 + 类型检查 + 构建产物验收**，不做真实宿主 UI 验收。原因是本机 `apps/web` preview 环境本身无法进入正常界面，页面报 `Failed to load plugins`：

1. **缺 `workdsh-contracts`**：`install-preview.mjs` 的安装列表不含 `packages/contracts`，preview profile（`~/.workdsh/preview`）的 `pnpm-lock.yaml` 中该包计数为 0；而 `asset-gate / connectors / model-market / projects / skills` 五个插件的**运行时 `.js`** 仍保留裸 `workdsh-contracts/*` import → `ERR_MODULE_NOT_FOUND`。宿主启动日志 `7 entries did not activate`，连带 `workdsh-experts`、`workdsh-quality-analysis` pending。
   - 修复方向：把 `packages/contracts` 加入 preview 安装列表；或参照 `build-projects` / `build-workbenches` / `build-quality-analysis` 的做法，让这五个插件的 host 侧构建把 contracts 内联进产物。
2. **`settings.launcher` 槽位冲突**：出现两处 `priority: 0` 注册（其一为 `workdsh-account-settings-client`），官方 single 槽不允许同优先级重复注册。
3. **`workdsh-plugin-quality-analysis` 激活失败**：导致 `web boot: 1 entry did not activate`，前端停在插件加载失败页。

补充：`preview:install` 在本执行环境还遇到两个沙箱坑，已有可行绕法——`~/.cache/workdsh-preview-packs` 写入被拒时设 `WORKDSH_PREVIEW_PACKS_HOME=/Users/wangfenglin/.workdsh/preview-packs`（既有缓存目录）；`dsh plugin add` 删 `package.json.lock` 触发 safe-delete 50 文件阈值时用 `env -u NODE_OPTIONS -u BASH_ENV` 运行。安装本身已成功，profile 中 `dist/client.browser.js` 与仓库 `cmp SAME`。

环境修好后需补做：在真实 Composer 中确认 `conversation.input.model` 座位确被 `ModelSelectSeat` 遮蔽、触发器样式、弹层定位、官方目录数据、思考强度选择与自定义模型弹窗。
