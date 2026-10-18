# WorkDSH Desktop 3.0.0-alpha.3

本次为专家预设目录修复版本，基于已通过检查的 `main` 合并提交 `069110dce84e63a1d26f1055b69f7b149ab6a439`。继续使用官方 DeepSeek Harness **0.2.1-rc.2**，保留完整原生对话与工作台并排布局。

## 修复内容

- 统一专家发布、预设读取与执行校验使用的目录。未设置 `DSH_AGENTS_HOME`、但设置了 `DSH_HOME` 时，统一使用 `$DSH_HOME/agents`，避免专家已经发布，执行时却因查找 `~/.agents` 而报“旧目录预设”或文件不存在。
- 显式指定的专家目录及 `DSH_AGENTS_HOME` 仍优先使用；未设置上述目录时继续使用 `~/.agents`。
- 此修复适用于 Desktop 与 Web 共用的专家插件，自托管 Web 仅配置 `DSH_HOME` 时直接受益。它不恢复已经丢失的预设文件，也不改变执行权限或沙箱设置。

## 验证

- 修复提交的源码检查、Web 回归、企业插件和 Windows x64、macOS Apple Silicon / Intel 打包检查均已通过。
- 合并后独立环境中的专家集成测试 **29 项通过**；额外验证了仅设置 `DSH_HOME` 时，团队专家发布后在重启前后均能读取已保存预设并通过执行前校验。
- 本次版本通过标签触发重新构建，发行工作流还会核对版本、来源提交、随包运行时、企业插件来源及附件 SHA-256。自动检查不代表各平台全部真实交互均已验收。

## 下载与升级

- Windows x64：`WorkDSH-3.0.0-alpha.3-x64-Setup.exe`。
- macOS Apple Silicon：`WorkDSH-3.0.0-alpha.3-arm64.dmg`。
- macOS Intel：`WorkDSH-3.0.0-alpha.3-x64.dmg`。
- 企业连接继续独立提供 `workdsh-enterprise-connection-0.1.0-alpha.2.tgz` 和 ZIP，基础安装包不预装企业账号与协作插件。
- 附件名称带构建平台前缀；下载后可依据 `SHA256SUMS` 核对完整性。本次 macOS DMG 未签名。

Desktop 与 Web 的 DSH Host、Client 和 SDK npm 包统一为 `0.2.1-rc.2`。Intel 的 Node、pnpm、Python、Office 资源及预编译工具仍来自单独校验的官方 `0.2.1-rc.1` Intel 归档，保留其真实元数据，不代表 DSH npm 底座回退。

当前产品仍为 Alpha。升级前请备份本地配置和数据；已经配置的独立专家目录应继续保留。第三方插件仍须满足当前 DSH 版本要求。

开源地址：[github.com/techflag/workdsh](https://github.com/techflag/workdsh)
