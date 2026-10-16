# MCP 市场接口规范

面向后台管理平台（`ai_mcp_tool` 表）需要实现的 HTTP 接口清单，供 WorkDSH 桌面端「连接器 → MCP 市场」页面对接。

调用方是**桌面端宿主进程**（Node 侧代理），不是渲染层浏览器。

后台地址来自随包预置的部署配置（`workdsh-config.json` 的 `enterprise.backendUrl`，由 `WORKDSH_DEPLOYMENT_CONFIG` 在打包时写入），由宿主进程注入插件，**代码不写死、渲染层拿不到**。登录态由主进程持有，插件只能按需获取授权头。

> 注意：MCP 市场是**企业后台能力**，Personal 模式没有后台地址，此接口族不会被调用。

---

## 0. 通用约定

### 0.1 响应信封

统一使用 Jeecg 风格信封，前端按 `code === 200` 判定成功：

```json
{
  "code": 200,
  "message": "操作成功",
  "result": {}
}
```

- 额外字段（`success`、`timestamp` 等）会被忽略，不影响对接。
- 失败示例：`{ "code": 500, "message": "查询失败", "result": null }`

### 0.2 认证与必需请求头

由抓包确认，业务后台需要以下请求头（`Authorization` 与 `X-Access-Token` 携带**同一个 JWT，且不加 `Bearer ` 前缀**）：

| 请求头 | 示例值 | 说明 |
| --- | --- | --- |
| `Accept` | `application/json, text/plain, */*` | |
| `Authorization` | `eyJhbGciOiJIUzI1NiIs...` | 裸 JWT，**不加 `Bearer `** |
| `X-Access-Token` | 同上 | 与 `Authorization` 同值 |
| `X-Sign` | —（**不需要**） | 已确认后台不校验，宿主请求不带此头 |
| `X-TIMESTAMP` | `1792047967003` | 毫秒时间戳 |
| `X-Tenant-Id` | `0` | 固定值 |
| `X-Version` | `v3` | 固定值 |

**已确认**：后台**不校验 `X-Sign`**，宿主请求不带此头。`X-TIMESTAMP` 发当前毫秒时间戳，`X-Tenant-Id: 0` 与 `X-Version: v3` 为固定值。

**已确认**：桌面端员工令牌（`/sys/pcClientLogin` 签发）可以调用这些接口，不需要额外授权。

### 0.3 网关前缀与路径配置

`server.baseUrl` **已经包含网关前缀**，例如 `http://127.0.0.1:18080/ytsj-ai`。接口路径直接拼在 `baseUrl` 之后。

所有路径都配置在 `workdsh-app.json` 的 `server` 段中，不在代码里写死。`server` 段在原有的 `baseUrl` / `loginPath` / `logoutPath` / `mePath` / `syncIntervalSeconds` 之外，已扩展出四个市场路径字段：`mcpMarketListPath`、`mcpMarketCategoriesPath`、`mcpMarketInstallPath`、`mcpMarketUninstallPath`。

**字段改名记录**：原来的 `mcpMarketSubscribePath` / `mcpMarketUnsubscribePath`（订阅 / 取消订阅语义）已改名为 `mcpMarketInstallPath` / `mcpMarketUninstallPath`（安装 / 卸载**上报**语义）。三处同步：随包 `workdsh-app.json`、Desktop `app-config.ts` 的 `ServerConfig` 与 `DEFAULTS`、connectors 插件的 `DEFAULT_MARKET_PATHS`。校验规则与其它路径一致（字符串且以 `/` 开头）。

已确认的列表接口完整形式（桌面端默认每页 24 条，按页取数）：

```text
{baseUrl}/desktop-client/mcptool/queryAuthorizedMcpToolList?pageNo=1&pageSize=24&_t=1792047966999
{baseUrl}/desktop-client/mcptool/queryAuthorizedMcpToolList?pageNo=1&pageSize=24&_t=1792047966999&bizScene=value1&keyword=办公
```

已确认的分类字典接口完整形式：

```text
{baseUrl}/desktop-client/mcptool/queryMcpToolBizSceneList
```

安装上报与卸载上报接口后台**尚未提供实现**（请求可达即可，后台逻辑目前为空），但接口签名已确认：两者都是 `POST` + `@RequestBody JSONObject`，参数在**请求体**里（不是 query）；完整路径见 §2.3、§2.4。

### 0.4 分页、筛选与排序（当前实现）

分类与关键词都走**服务端筛选**，界面不再做市场侧的本地过滤；分页是**真分页**，界面滚动到接近底部时按页加载更多。

宿主当前请求形态：

| 参数 | 示例 | 说明 |
| --- | --- | --- |
| `pageNo` | `1` | 页码。首屏、切换分类、修改关键词都重置为 `1`；滚动加载更多时递增 |
| `pageSize` | `24` | 每页条数，由界面分页常量决定 |
| `bizScene` | `value1` | **有分类时下发**，取分类字典的 `value`；无筛选不下发 |
| `keyword` | `办公` | **有关键词时下发**；无关键词不下发 |
| `_t` | `1792047966999` | 毫秒时间戳，防缓存 |

- **不下发 `column` / `order`**：排序由后台决定，前端不再指定排序字段与方向。
- 分类筛选作用在 `biz_scene` 上，而 `biz_scene` 是**逗号分隔的多值字段**；因此后台需要按**多值包含匹配**处理（例如 `FIND_IN_SET(#{bizScene}, biz_scene)` 或等价写法），否则多值条目会被漏掉。这是本轮明确提出的后台改动要求。
- `bizScene` / `keyword` 的查询参数名沿用实体字段名与通用关键词参数：后台列表走 `QueryGenerator`，实体字段可以直接当查询参数，因此不需要额外定义接口签名。
- 列表响应 `result.current` 用于确认当前页码，`result.total` 用于判断「是否还有下一页」与展示结束提示（`已加载全部 N 个 MCP`）。
- **原始记录**：曾有一版过渡方案（`pageSize=100` 一次取回全量 + 界面本地过滤 + `column`/`order` 排序），已废弃。

列表响应中 `result` 结构（实测）：

```json
{
  "current": 1,
  "size": 8,
  "total": 5,
  "pages": 1,
  "records": []
}
```

### 0.5 字段命名

JSON 字段使用 **lowerCamelCase**（如 `serviceId`、`toolCount`），对应表的下划线字段。

---

## 1. 表字段 → 连接器字段映射

实现时请按此对应关系返回数据：

| `ai_mcp_tool` 字段 | 连接器侧字段 | 说明 |
| --- | --- | --- |
| `id` | `originId` | 用于「已安装」判定与卸载 |
| `name` | `title` | 显示名称 |
| `service_id` | `serverName` | **唯一键判重**；表上已有唯一索引 `uk_ai_mcp_tool_service_id`，正好对应 |
| `description` | `description` | 说明 |
| `transport` | `transport` | `http` 与 `sse` 都按 `streamable-http` 处理，`stdio` 按 `stdio`（见 §5 决策 3） |
| `command` + `args` | `command` + `args` | `args` 表里是「每行一个」，连接器侧是字符串数组 |
| `endpoint` | `url` | `transport = http` 或 `sse` 时使用 |
| `token` | 暂不使用 | 列表接口**永不返回** token；返回 token 的「取连接配置」接口本轮推迟（见 §2.3） |
| `biz_scene` | `categories` | **已确认**：分类取 `biz_scene`；该字段是**逗号分隔的多值**，桌面端拆成值的数组，仅用于分类筛选取值与安装时判重（见 §2.2 实测补充） |
| `biz_scene_list`（新） | `categoryLabels` | **已确认**：后台按 `biz_scene` 逐项展开的 DictModel 数组（`value` / `text` / `label` / `title` / `color`）。桌面端**只取名称字段**（`text` → `label` → `title`）作为卡片与详情的标签文案，多值全部展示、按后台顺序去重，**不再回查分类字典**；字段缺失时才退回用分类字典映射 `biz_scene` |
| `source_node` + `source_node_list`（新） | 暂不使用 | 来源节点，本轮界面不展示，仅确认字段已下发 |
| `subscribers` | 卡片「订阅数」 | 原样整数 |
| `download_count` | 卡片「下载数」 | 原样整数 |
| `star_count` | 卡片「收藏次数」 | 原样整数 |
| `icon` + `color` | 卡片图标 | `icon` 是 emoji 或 `ant-design:xxx`（见 §5 问题 4） |

**统计数请返回原始整数**（例如 `698400`），不要返回 `69.84w` 这类已格式化的字符串——前端会按 `69.84w` 自行格式化，且排序筛选需要数值。

---

## 2. 接口清单

### 2.1 分类字典 — 列表

分类标签栏的数据来源（「全部 / 办公协同 / 开发工具 / …」）。

```
GET  {server.baseUrl}/desktop-client/mcptool/queryMcpToolBizSceneList
```

请求参数：无

响应 `result` 为 `DictModel` 列表（结构见 §5 问题 2），**实测共 15 项**，多出的 `label` / `title` / `jsonObject` 字段忽略：

```json
[
  { "color": null, "jsonObject": null, "label": "办公协同", "text": "办公协同", "title": "办公协同", "value": "value1" }
]
```

- `value`：**服务端筛选参数** `bizScene` 的取值（列表接口按它过滤，见 §2.2）
- `text`：界面上显示的标签文字（桌面端用 `value → text` 的映射把条目的 `bizScene` 显示为标签）
- `color`：可选，界面暂不使用

**实测现状（测试数据问题，后台会统一）**：字典当前的 `value`（`value1` … `value15`）与列表里的 `bizScene` 实际取值**对不上**。后台会把 `biz_scene` 统一改成存字典 `value`（见 §5.1 决策 7）；在那之前，桌面端把「映射不到字典的 value」**直接跳过、不显示原始编码**，因此不会出现 `value3` 这种给用户看的乱码。

### 2.2 市场列表

```text
GET  {server.baseUrl}/desktop-client/mcptool/queryAuthorizedMcpToolList
```

请求参数（**当前实现**）：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `pageNo` | 否 | 页码，首屏/切换筛选为 `1`，滚动加载更多时递增 |
| `pageSize` | 否 | 每页条数，默认 `24` |
| `bizScene` | 否 | 分类筛选，取分类字典的 `value`；**有分类时下发**，无筛选不下发 |
| `keyword` | 否 | 关键词；**有关键词时下发**，无关键词不下发 |

- **不传** `column` / `order`：排序由后台决定。
- 分类与关键词都由服务端筛选，界面侧不再对市场列表做本地过滤；翻页由界面「滚动加载更多」逐页触发。
- 后台要求：`bizScene` 作用在逗号分隔的多值字段 `biz_scene` 上，需要**多值包含匹配**（`FIND_IN_SET` 或等价写法）。详见 §0.4。
- 响应必须回传 `total` 与 `current`：`total` 用于判断是否还有下一页，界面据此显示结束提示。

响应 `result`：

```json
{
  "records": [
    {
      "id": "1859123456789012345",
      "name": "腾讯文档 MCP",
      "icon": "📄",
      "color": "#2f6fd0",
      "serviceId": "tencent-docs",
      "version": "v1.0.0",
      "bizScene": "办公协同",
      "tags": "文档,协同",
      "transport": "http",
      "endpoint": "https://mcp.example.com/tencent-docs",
      "command": null,
      "args": null,
      "description": "PDF 全格式文档读取与编辑。",
      "tools": [
        {
          "name": "read_document",
          "description": "读取文档并返回结构化文本。",
          "parameters": [
            { "name": "file_path", "required": true, "description": "文件路径" }
          ]
        }
      ],
      "toolCount": 2,
      "subscribers": 698400,
      "downloadCount": 76000,
      "starCount": 12000,
      "rating": 4.70,
      "healthStatus": "online",
      "lastCheckTime": "2026-10-15 10:00:00",
      "owner": "张三",
      "department": "研发中心",
      "builtin": 0,
      "status": "3"
    }
  ],
  "total": 128,
  "current": 1,
  "size": 24
}
```

**硬性要求：**

1. **`token` 不在此接口返回**（表中注释已明确「列表/详情不回显」）。token 只在 §2.3 返回。
2. `tools` 结构见 §3；如果你们的 `tools` 已经是另一种结构，请给一份样例，前端做映射即可。
3. `transport` 与 `command`/`args`/`endpoint` 需要能支撑「预览」展示（列表页详情要显示连接方式）。

**实测补充（桌面端接口，测试数据问题按「后台后续统一」处理，桌面端不做兼容）：**

1. `tools` 是 JSON **字符串**（不是数组），结构与 §3 一致，按 `[{name, description, inputSchema}]` 解析；`"[]"` 或空表示该 MCP 暂无工具清单，界面显示空清单而不是报错。
2. `status` 目前包含非上架记录（例如 `"1"` 草稿）。**接口返回什么就显示什么，桌面端不做 `status` 过滤**（与 §4 的服务端过滤要求的关系待后台确认）。
3. `bizScene` 目前是测试数据、形态混乱：有的是逗号分隔的雪花 ID（如 `1990030000000000001,1990030000000000011`），有的是自由文本（如 `网页检索`、`AI 推理`），个别还是把名称粘进来的脏数据。桌面端**只按逗号拆分并去空去重**（不做清洗、不猜测匹配）。**标签文案一律取 `bizSceneList` 的名称字段**（见 §1），多值全部展示；`bizSceneList` 缺失时才退回用分类字典逐项映射 `value → text`，映射不上的项直接跳过，一个都映射不上就整个不显示分类（不留空占位、不显示原始编码）。
4. `icon` 仍是 `ant-design:api-outlined` 这类值或 `null`，后台后续会改成 http 可达 URL；桌面端按 §5.1 决策 8 处理（URL 可达才渲染，否则回退「名称首字母 + `color`」）。
5. `endpoint` / `command` / `args` / `transport` / `token` 的映射与本文其余部分一致，无需改动。

### 2.3 安装上报

用户点卡片上的「＋」安装到本机时，宿主进程先调用**安装上报接口**告知后台，再在本地落地连接器实例。

```text
POST {baseUrl}{mcpMarketInstallPath}
```

- `mcpMarketInstallPath` 的真实取值：`/desktop-client/mcptool/installMcpTool`
- **没有 query 参数**：后台接口是 `@PostMapping` + `@RequestBody JSONObject`，`id` 等参数全部放在请求体里

请求体（JSON）：

```json
{ "id": "1859123456789012345", "serviceId": "tencent-docs", "clientType": "workdsh-desktop" }
```

| 字段 | 说明 |
| --- | --- |
| `id` | §2.2 的市场条目 `id`（安装后作为本地连接器的 `originId`） |
| `serviceId` | §2.2 的 `serviceId`；与 `id` 一并下发，后台可直接关联，无需额外查询 |
| `clientType` | 固定 `workdsh-desktop`，用于区分客户端来源 |

**字段名为待对齐项**：后台目前只声明收一个 `JSONObject`、未固定字段名；实现后如需改名，前端只需调整请求体构造这一处。

响应：后台逻辑**目前为空**，直接返回 `Result.OK()`，因此 `result` 为 `null`（`code` 为 `200`）。**桌面端不解析响应体，也不会因为返回体为空而判定安装失败**——信封 `code === 200` 即视为上报完成。

副作用（待后台实现）：记录安装行为，可选地让 `subscribers` 计数 +1。

**不返回连接配置**：安装所需的字段（`serviceId` / `name` / `description` / `transport` / `endpoint` / `command` / `args` / `bizScene`）全部取自 §2.2 的列表结果，映射见 §1。

### 2.4 卸载上报

卸载本机实例时，宿主进程先调用**卸载上报接口**，再移除本机实例。

```text
POST {baseUrl}{mcpMarketUninstallPath}
```

- `mcpMarketUninstallPath` 的真实取值：`/desktop-client/mcptool/unInstallMcpTool`（**`unInstall` 里的 `I` 大写，大小写必须精确匹配**）
- 请求体与 §2.3 完全一致：`{ "id": <市场条目 id>, "serviceId": <服务标识>, "clientType": "workdsh-desktop" }`；同为 `@RequestBody JSONObject`，无 query 参数

响应同 §2.3：`Result.OK()` 的 `result` 为 `null`，桌面端不解析。

**上报失败的取舍（已确认实现）**：上报失败**不阻断本地卸载**。后台异常或网络问题时若直接报错，用户会卡在「卸载不掉、也删不掉」的状态；因此桌面端先保证本机可清理，并把上报结果反馈给界面（提示「已从本机移除，但市场卸载上报失败，后台记录可能未同步」）。

**待后台确认**：请求体字段名（当前为 `id` / `serviceId` / `clientType`）、是否需要额外的用户/设备标识、重复上报是否幂等。

### 2.5 取连接配置（含 token）— 本轮推迟

原先设计的「安装配置」接口（`POST .../subscribe`，返回 `serviceId` / `name` / `transport` / `endpoint` / `command` / `args` / `token`）**本轮不接入**：

- 列表接口已返回安装所需的全部连接字段，安装流程不再依赖该接口；
- `token` 的流转路径（宿主写入官方凭据服务、连接器定义只存引用、列表/详情/诊断永不回传）保持原有设计不变，待该接口就绪后再接；
- 在那之前，需要令牌的 MCP 由用户在本机「＋ 添加 MCP」里手工填写授权令牌。

### 2.6 收藏（可选，暂不阻塞）

界面上「收藏次数」目前是只读展示，没有收藏按钮。若后续要加收藏功能，再补：

```
GET  {base}/mcp/market/starred      // 我收藏的
POST {base}/mcp/market/{id}/star    // 收藏
POST {base}/mcp/market/{id}/unstar  // 取消收藏
```

本轮**不要求实现**。

---

## 3. 工具清单 `tools` 的 JSON 结构

详情页要展示「工具名 + 说明 + 参数」，所以 `tools` 至少需要名称和说明。

**实测结构（已确认）**——注意 `tools` 是**字符串**，内容是 JSON 序列化后的文本，需要二次 `JSON.parse`：

```json
"[{\"name\":\"echo\",\"description\":\"回显文本，用于验证 tools/call\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"text\":{\"description\":\"要回显的内容\",\"type\":\"string\"}},\"required\":[\"text\"]}}]"
```

解析后的单条工具结构：

```json
{
  "name": "echo",
  "description": "回显文本，用于验证 tools/call",
  "inputSchema": {
    "type": "object",
    "properties": {
      "text": { "description": "要回显的内容", "type": "string" }
    },
    "required": ["text"]
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `name` | 工具名 |
| `description` | 工具说明 |
| `inputSchema` | 标准 JSON Schema。入参取 `properties`，`required` 数组决定是否标注「必填」 |

对接要点：

1. `tools` 为 `"[]"` 或空表示该 MCP 暂未提供工具清单（实测中 `toolCount: 0` 的记录就是这种情况），界面显示空清单而不是报错。
2. **没有 `kind` 字段**，所以详情页的「类型标签」（读写 / 查询）在市场上也不会出现。此前原型里的类型标签来自我造的假数据，真实数据结构里不存在。如果你们希望有这个标签，需要在 `tools` 里补一个字段；不补就不显示，我不会去猜规则。
3. `tools` 里的入参描述可能极长（实测有单条工具说明超过 2000 字符），界面会做截断与折叠。

---

## 4. 列表过滤与排序

**实测现状（桌面端接口）**：当前的桌面端列表接口返回**全部状态**的记录（含 `status: "1"` 草稿），桌面端按「接口返回什么就显示什么」展示，**不做 `status` 过滤**（见 §2.2 实测补充 2）。下面这条服务端过滤要求是否对桌面端接口生效，待后台确认。

**过滤条件（服务端必须加）：**

```sql
del_flag = 0
AND status = '3'        -- 仅已上架（1草稿 2待审批 3已上架 4已驳回 5已下架）
```

**可选过滤：**

- `is_public = '公开'` — 成员侧市场是否只看公开资产，请按部署策略确认

**建议排序：**

```sql
ORDER BY builtin DESC, subscribers DESC, update_time DESC
```

**关键词搜索：** `keyword` 已由宿主下发（有值才发，见 §0.4），服务端建议用 `name LIKE %kw% OR description LIKE %kw%`。

**分类筛选：** `bizScene` 已由宿主下发（有值才发），取值是分类字典的 `value`；由于 `biz_scene` 是逗号分隔的多值字段，服务端必须按**多值包含匹配**实现（`FIND_IN_SET(#{bizScene}, biz_scene)` 或等价写法），否则多值条目会被漏掉。

---

## 5. 已确认决策与剩余待确认

### 5.1 已确认决策（实现时以此为准）

| # | 议题 | 决策 |
| --- | --- | --- |
| 1 | 分类字段 | 取 **`biz_scene`**；分类字典接口、列表 `bizScene` 筛选参数都按它。该字段是**逗号分隔的多值**，服务端筛选按多值包含匹配（§0.4） |
| 2 | 字典对象字段名 | 用 **`value` / `text` / `color`**（照 `DictModel` 实际字段，§2.1 示例已按此编写） |
| 3 | `transport = sse` | **按 `streamable-http` 处理**（风险见 5.2 决策 3） |
| 4 | token 下发 | **本轮推迟**：不再有「取连接配置」接口调用，安装字段全部来自列表；`token` 的写入与回显约束保持原设计（见 §2.5） |
| 5 | `X-Sign` | 后台**不校验**，宿主请求不带此头；`X-TIMESTAMP` 发当前毫秒，`X-Tenant-Id: 0` 与 `X-Version: v3` 固定 |
| 6 | 员工令牌权限 | 员工令牌（`/sys/pcClientLogin` 签发）**可访问**这些接口，无需额外授权 |
| 7 | 分类数据来源 | 后台**新建业务场景字典**，`biz_scene` 改存字典 `value`；分类接口返回该字典（此后 `biz_scene` 不再是自由文本） |
| 8 | `icon` 字段 | 后台把 `icon` 改成 **http 可达的 URL**；桌面端按「设置页用户头像」的同一套方式加载，**URL 不可达或为空时退回「名称首字母 + `color` 底色」** |

### 5.2 决策说明

#### 决策 3 的风险说明

`http` 与 `sse` 都映射为 `streamable-http` 是**配置层面的归一**，不代表协议兼容。MCP 的旧 SSE 传输（2024-11-05 规范）与 Streamable HTTP（2025-03-26 规范）是两种不同协议，官方 MCP 客户端只实现了后者。

因此如果存量 `sse` 记录指向的是真正的旧 SSE 端点，连接会失败，届时以「连接异常」的形式暴露在连接器界面上并由诊断信息说明。若后续发现这类记录较多，需要重新评估方案。

#### 决策 4 的实现约束（推迟接入）

「取连接配置」接口本轮不接入（见 §2.5），但该接口一旦实现，必须保证：

1. 列表与详情接口**绝不返回** `token`
2. 该接口需要鉴权，只允许持有有效登录态的调用方获取
3. 返回的 token 由宿主进程写入 DSH 官方凭据服务，连接器定义里只保存引用，之后所有列表/详情/诊断都不会回传

---

### 5.3 保留的原始问题（作为上下文，已确认项以 5.1 为准）

### 问题 1：分类对应表里哪个字段？

表里有三个候选：`biz_scene`（所属业务场景，注释写「暂手工标签」）、`tags`（标签）、`source_node`。

界面上「办公协同 / 开发工具 / 数据分析」这类标签，请确认取自哪个字段。同时确认 §2.2 的 `scene` 筛选参数是否也按该字段过滤。

### 问题 2：`DictModel` 的字段名到底是 `value/text` 还是 `code/name`？

你提到「`[{code,name}]`」，但 `DictModel.java` 的实际字段是：

```java
private String value;   // 字典 value
private String text;    // 字典文本
private String color;   // 字典颜色
```

Jeecg 默认序列化输出的是 `value` / `text` / `color`（另有派生的 `title` / `label` getter 也会被序列化）。

**本规范按 `value` / `text` / `color` 编写。** 如果你确实要输出 `code` / `name`，请告知，我改前端映射（改动很小，但必须一致）。

### 问题 3：`transport = sse` 怎么办？

**这是一个硬约束，需要你决策。**

- 表里 `transport` 定义为 `http / sse / stdio`
- 但官方 MCP 客户端只支持 **`stdio` 和 `streamable-http`** 两种，没有 SSE 传输
- 且 MCP 的 SSE 传输（2024-11-05 规范）已在 2025-03-26 规范中被 Streamable HTTP 取代

可选方案：

| 方案 | 说明 |
| --- | --- |
| A. 市场侧只上架 `http` 和 `stdio` | **推荐**。`sse` 类型的记录不上架或下架 |
| B. 兼容处理 | 若某条记录是 `sse`，市场接口仍返回，但安装时明确报错提示「暂不支持 SSE 传输」 |
| C. 单独排期适配 | 需要额外的传输实现，官方运行时未提供，成本较高 |

请确认取哪个方案。默认我会按 **A** 实现（遇到 `sse` 的记录在安装时给出明确错误）。

### 问题 4：`icon` 是 emoji 还是 ant-design 图标名？

表注释写「图标，如 `ant-design:api-outlined` 或 emoji」。

| 类型 | 处理 |
| --- | --- |
| emoji（如 `📄`） | 直接渲染，配合 `color` 作为底色 |
| `ant-design:xxx-outlined` | 需要一份图标名到图形的对照表，或统一改成 emoji |

**建议统一用 emoji**，实现最简单、无依赖。请确认。

### 问题 5：token 的流转路径确认

本规范的链路是：

```
渲染层 → 宿主进程 → POST /mcp/market/{id}/subscribe → 拿到 token → 写入 DSH 官方凭据服务
                                                                        ↓
                                            连接器定义里只保存 authorizationCredentialRef
```

即 **token 永远不进入渲染层，也不落进连接器定义**。列表、详情、诊断都不会回传令牌。

请确认 `subscribe` 接口能返回 token。如果 token 必须由用户在界面上手工填写（即接口不返回），请告知，我会改成打开配置表单让用户粘贴。

### 问题 6：安装/卸载上报是否需要幂等？

同一用户重复点安装、重装或重复卸载时，后台计数是否应该重复变化？（原为 `subscribe` 接口的问题，已随接口改名为「安装上报」）

- 建议：**幂等**（按用户维度记录，重复上报不重复计数）
- 或者：由前端保证只调一次，服务端不去重

请确认。

---

## 6. 我方已就绪的对接点

为方便你对照，以下是我这边已经具备的能力：

| 能力 | 状态 |
| --- | --- |
| 连接器定义新增 `originId`（来源市场条目 id，用于「已安装」判定） | 已完成 |
| 连接器定义新增 `categories`（市场分类名称，取 `bizSceneList` 全部名称，用于本地卡片/详情展示与分类筛选） | 已完成 |
| 按 `service_id` → `serverName` 判重（冲突报错） | 已完成 |
| stdio / streamable-http 两种传输的连接与断线重连 | 已完成 |
| token 写入官方凭据服务，定义只存引用，不回显（待「取连接配置」接口就绪后启用） | 已完成 |
| 本地 MCP 工具详情（名称 + 说明 + 入参，含「必填」标记） | 已完成 |
| 市场 Tab 界面（双 Tab、分类胶囊、卡片统计、已安装态、详情工具清单、滚动加载更多） | 已完成 |
| 宿主代理端点 + 市场服务客户端（列表 / 分类字典 / 安装上报 / 卸载上报） | 已完成 |
| 分类与关键词服务端筛选（下发 `bizScene` / `keyword`） | 已完成 |
| 取连接配置（含 token）接口 | **本轮推迟**（§2.5） |

后台按本规范补齐「安装上报 / 卸载上报」的实现（并让 `bizScene` 支持多值包含匹配）后，市场链路即为完整。
