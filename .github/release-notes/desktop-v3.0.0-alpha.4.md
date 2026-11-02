# WorkDSH Desktop 3.0.0-alpha.4

升级至官方 DeepSeek Harness **0.2.1-rc.5**。Desktop 与 Web 共用相同版本的 Host、Client 与 SDK，保留完整原生对话，以及工作台与 AI 对话并排布局。

## 更新内容

- 跟进官方对话思考内容展示优化。
- 保留官方新增的侧栏、会话视图和右侧栏“更多”菜单，可浏览和创建插件。
- 包含官方未发送草稿找回、API Key 模型目录更新方式及 ACP 诊断输出修复。
- 同步内置插件兼容声明、依赖锁与官方 Web 客户端清单。工作台外框适配继续仅修改两个已授权挂载位置，并校验原始及适配后文件摘要。

## 验证范围

- 升级 PR 的 Web、Windows、macOS Apple Silicon / Intel 与企业插件 CI 全部通过。
- 本地通过 Web 与业务插件构建、类型检查；Desktop 164 项测试通过、2 项跳过；工作台共用交付逻辑 313 项测试通过。
- 实测 macOS ARM 候选安装目录内的运行时启动，以及原生主界面、工作台管理、创建入口和官方“更多”菜单。隔离 Web 预览启动与认证请求通过。
- 未调用付费模型重新制作业务应用；本地未执行 Windows / Intel 完整图形交互验收。发行工作流会重新执行三平台构建及随包运行时检查。

## 下载与升级

- Windows x64：`WorkDSH-3.0.0-alpha.4-x64-Setup.exe`。
- macOS Apple Silicon：`WorkDSH-3.0.0-alpha.4-arm64.dmg`。
- macOS Intel：`WorkDSH-3.0.0-alpha.4-x64.dmg`。
- 企业连接插件独立提供 TGZ 和 ZIP，基础包不预装企业账号与协作。
- 下载文件带平台前缀，可依据 `SHA256SUMS` 校验。本次 macOS DMG 未签名。

三个平台的 DSH npm 包统一为 **0.2.1-rc.5**。Intel 运行工具来自单独核验的官方 **0.2.1-rc.4** 归档，因为官方尚未提供 rc.5 Intel 安装包；其原始元数据与来源校验值保持不变，不代表 Host、Client 或 SDK 回退。

当前仍为 Alpha。升级前请备份本地配置与数据。现有第三方插件和自行生成的工作台可能需要适配新底座；不自动豁免版本兼容检查。

开源地址：[github.com/techflag/workdsh](https://github.com/techflag/workdsh)
