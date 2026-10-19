# WorkDSH Desktop 外壳

[English](README.md)

本包构建 Electron 应用，包含一套个人运行时 Profile。官方 DeepSeek Harness 拥有 Host、完整 Web 客户端及核心执行；共享 WorkDSH 功能包提供经核对的 Profile 所选产品能力，不代表预装全部专家定义、Skill 或 MCP 服务。企业账号和协作作为外置插件显式安装，基础安装包不预装；通知及独立业务应用同样是可选外置插件。

## 个人与企业连接

外壳先显示使用方式选择。个人模式启动个人本机 Home/Profile。企业管理员在打包配置中固定公司后台 HTTPS 地址，员工通过 Main 登录并核验真实组织与成员；HTTP 仅允许回环开发地址。登录后在独立成员空间启动本机官方 DSH，不再打开远端企业 Web。企业执行仍在员工桌面端，服务器提供账号、授权、协作数据与模型转发。

先在个人空间安装并启用企业连接插件，再登录公司账号。企业插件缺失或版本不兼容时阻止企业进入。企业空间按后台、组织和成员隔离配置、凭据、技能根与窗口存储；两种模式仍使用同一官方客户端、设置和右侧面板。安装插件不授予成员资格或业务权限，权限由后台核验。

后台登录 bearer 只在 Main 内存，业务页面和 DSH CLI 不持有它。受控本机接口按固定账号逐操作复验，只提供账号、退出和可见正文同步。企业账号页复用插件页面，显示组织名称、同步状态、重试/删除和退出。

退出先封闭企业请求，停止本机 DSH 与工具进程，再清理认证文件及企业窗口存储。远端撤销失败时仍停止本机并显示未确认状态；个人与成员业务数据保留。其他插件的安装期间退出会取消拥有的安装进程；启动失败不遗留认证接口。目录分离不等于操作系统安全沙箱。

企业模型由成员在官方自定义模型 API 页面手工填写内部地址、Key、协议和模型。管理服务负责 Spring AI 转发与组织授权；外壳不注入模型 provider 或替换设置页。企业插件只同步已提交正文，工具、思考、未分享文件和凭据不上传；后台管理员只读查看本组织正文并留审计。这不是完整或不可绕过的终端审计。

企业管理员先复制 `config/enterprise.example.json` 并填写后台地址，再打包：

```json
{"enterprise":{"backendUrl":"https://workdsh.company.com"}}
```

```sh
WORKDSH_DEPLOYMENT_CONFIG=/absolute/path/company.json corepack yarn workspace dsh-plugin-desktop package:dir
```

打包将校验后的配置写入应用 Resources 的 `workdsh-config.json`，员工入口只显示该地址，不允许改写。配置只接受 `enterprise.backendUrl`，拒绝密码或 Key。未设置此环境变量的个人构建生成空配置，不沿用上一次公司的地址。开发可运行 `corepack yarn dev` 并手填地址，或用 `WORKDSH_ENTERPRISE_PORTAL` 预填；这不是企业交付配置。

个人包预置的默认模型访问值放在 `resources/model-credentials.json`（「`apiKeyEnv` 引用名 → 值」映射，经 `extraResources` 直接进入安装包 Resources）。它承载的是**非机密**访问值（由部署环境在网关/IP 层校验），载体仅在个人工作区注入，企业工作区不受影响；值留空表示未提供。运行时优先级仍是「启动环境变量 > 该文件 > 官方 `.credentials.yaml`」。

## 开发与验证

使用 Node.js `^22.19.0` 或 `>=24`，以及通过 Corepack 启动的 Yarn 4.18.0。在仓库根目录执行：

```sh
corepack yarn install --immutable
corepack pnpm --dir apps/web install --frozen-lockfile
corepack pnpm --dir apps/web build
node apps/desktop/scripts/pack-workdsh-profile.mjs apps/web
corepack yarn dev
```

`dev` 构建外壳、准备固定版本 Profile 和主运行时，再启动 Electron。图形启动保持显式。无界面验证使用：

```sh
corepack yarn test
corepack yarn typecheck
corepack yarn check:bilingual-docs
corepack yarn check:desktop-dsh-alignment
```

`corepack yarn check` 是完整 headless 门禁。`corepack yarn workspace dsh-plugin-desktop package:dir` 生成未压缩应用并检查重复 DSH 依赖树。单元测试使用 mock Electron 生命周期，不代表真实窗口、打包运行时或服务器验收。

`corepack yarn release:pack` 构建并打包同一提交的 Web 源码与经过核对的 Desktop 组合，保留干净源码发行门禁。Web 发行目录同时生成 `desktop-release-manifest.json` 与对应哈希命名制品，供已发布 Desktop 打包使用。

先构建共享功能及其必要支撑包。`pack-workdsh-profile.mjs` 在 `build/workdsh-profile-release` 生成不可变制品与版本/哈希清单；其他候选通过 `WORKDSH_RELEASE_DIRECTORY` 显式选择。运行时准备安装固定官方版本，生成可移植锁文件，并携带 pnpm JavaScript CLI 支持显式插件操作。`scripts/workdsh-package-boundary.mjs` 中的包清单定义经核对的默认 bundle 与必要支撑包，企业插件不包含在基础安装包中。同一 Profile 保留固定的 SkillHub 0.2.16 和 dshmarket 1.66.8 目录集成，不代表目录内容全部安装或经 WorkDSH 审核。不打包正在使用的用户配置或凭据。

`upstream.json` 按用户明确要求，将 Desktop 与 Web 实际使用的 Host、Client 和 SDK npm 包统一固定为官方 **DSH 0.2.1-rc.2**。产品构建使用已发布包，不导入或编译官方源码。既有应用与 Profile 的实际版本需单独核验；版本一致性、Desktop 检查与打包运行时验收全部通过后才能宣布升级完成，Web 预览证据不能代替。默认选择经过验证的官方稳定版。

官方 Desktop 归档单独提供 Node、pnpm、Python、Office 资源和预编译命令工具，每个目标记录实际归档版本、URL、大小和 SHA-512。上游尚未发布 Intel `rc.2` 归档，因此 Intel 工具明确使用官方 `0.2.1-rc.1` 归档并保留原始运行时元数据。这不会降级 DSH npm 包，也不启用自动回退；Intel 发行仍须通过实际安装包 x64 Resources 的验证。

外壳源码与打包脚本位于本目录，共享 WorkDSH 功能源码位于仓库 `packages/`。官方 DSH 通过已发布包接入，不检出其源码。企业管理与模型转发由独立的 WorkDSH Admin 仓库负责。参见 [Desktop 归属](../../docs/desktop-boundaries.md)。
