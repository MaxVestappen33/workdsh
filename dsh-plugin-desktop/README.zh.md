# WorkDSH Desktop 外壳

[English](README.md)

本包构建 Electron 应用，包含一套个人运行时 Profile。官方 DeepSeek Harness 拥有 Host、完整 Web 客户端及核心执行；WorkDSH 功能包提供共同的专家、Skill、资料库和 MCP/连接器。这是默认自有功能边界，不代表预装全部定义或 MCP 服务。企业账号插件随只读运行包提供、仅企业登录后启用；个人 Profile 不启用它。协作与通知仍为显式安装的外置插件。

## 个人与企业连接

外壳先显示使用方式选择。个人模式启动个人本机 Home/Profile。企业管理员在打包配置中固定公司后台 HTTPS 地址，员工通过 Main 登录并核验真实组织与成员；HTTP 仅允许回环开发地址。登录后在独立成员空间启动本机官方 DSH，不再打开远端企业 Web。企业 Web 自身仍在 ECS 按账号运行。

企业账号插件从安装包的共同官方依赖图加载，不需要员工再安装 tgz；缺失、版本不匹配或成员目录同名包遮蔽时阻止企业进入。个人默认组合不选择企业账号；协作与通知不自动安装。企业空间按后台、组织和成员隔离配置、凭据、技能根与窗口存储，仍使用同一官方客户端、设置和右侧面板。本轮只实现账号/正文适配，不自动安装协作或通知。

后台登录 bearer 只在 Main 内存，业务页面和 DSH CLI 不持有它。受控本机接口按固定账号逐操作复验，只提供账号、退出和可见正文同步。企业账号页复用插件页面，显示组织名称、同步状态、重试/删除和退出。

退出先封闭企业请求，停止本机 DSH 与工具进程，再清理认证文件及企业窗口存储。远端撤销失败时仍停止本机并显示未确认状态；个人与成员业务数据保留。其他插件的安装期间退出会取消拥有的安装进程；启动失败不遗留认证接口。目录分离不等于操作系统安全沙箱。

企业模型由成员在官方自定义模型 API 页面手工填写内部地址、Key、协议和模型。管理服务负责 Spring AI 转发与组织授权；外壳不注入模型 provider 或替换设置页。企业插件只同步已提交正文，工具、思考、未分享文件和凭据不上传；后台管理员只读查看本组织正文并留审计。这不是完整或不可绕过的终端审计。

企业管理员先复制 `config/enterprise.example.json` 并填写后台地址，再打包：

```json
{"enterprise":{"backendUrl":"https://workdsh.company.com"}}
```

```sh
WORKDSH_DEPLOYMENT_CONFIG=/absolute/path/company.json corepack yarn package:dir
```

打包将校验后的配置写入应用 Resources 的 `workdsh-config.json`，员工入口只显示该地址，不允许改写。配置只接受 `enterprise.backendUrl`，拒绝密码或 Key。未设置此环境变量的个人构建生成空配置，不沿用上一次公司的地址。开发可运行 `corepack yarn dev` 并手填地址，或用 `WORKDSH_ENTERPRISE_PORTAL` 预填；这不是企业交付配置。

## 开发与验证

使用 Node.js `^22.19.0` 或 `>=24`，以及通过 Corepack 启动的 Yarn 4.18.0。在仓库根目录执行：

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack pnpm --dir workdsh-web build
node dsh-plugin-desktop/scripts/pack-workdsh-profile.mjs workdsh-web
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

先在 WorkDSH 构建四个自有功能、必要支撑包及企业账号包。`pack-workdsh-profile.mjs` 在 `build/workdsh-profile-release` 生成不可变制品与版本/哈希清单；其他候选通过 `WORKDSH_RELEASE_DIRECTORY` 显式选择。运行时准备安装固定官方版本，生成可移植锁文件，并携带 pnpm JavaScript CLI 支持显式插件操作。门禁拒绝额外默认功能包，并验证真实插件管理器恰好展示四个 WorkDSH bundle；企业账号仅企业登录后启用。同一 Profile 保留固定的 SkillHub 0.2.16 和 dshmarket 1.66.1 目录集成，不代表目录内容全部安装或经 WorkDSH 审核。不打包正在使用的用户配置或凭据。

Desktop pin 与共同产品目标均为 **DSH 0.2.0-rc.2**，由用户明确选择。未修改的官方 `dsh-v0.2.0-rc.2` tag 固定提交 `639ed015397290b3745d163aafe02ffee4aa3f84`。既有安装包和 Profile 的实际版本需要单独核验。Desktop alignment、Desktop checks 和 packaged-runtime 验收都通过后才能宣布统一升级完成；Web Docker 证据不能代替。默认选择经过验证的官方稳定版。

上游 checkout 保持只读。外壳源码与打包脚本在本目录，功能包源码属于 WorkDSH，服务器启动器/网关配方由该工程 deploy/member-process 拥有。参见 [Desktop 归属](../docs/desktop-boundaries.md)。
