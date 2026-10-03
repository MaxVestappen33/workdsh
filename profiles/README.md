# 个人与企业的共同运行来源

更新：2026-10-02。个人和企业使用同一精确锁定官方DSH 0.2.0-rc.2版本族与完整Web；企业按账号独立官方进程运行。

| 来源 | 用途 |
| --- | --- |
| package.json与pnpm-lock.yaml | 精确官方版本族和工程依赖 |
| shared/workdsh-features.json | 共同自有功能包来源，不等于全部默认安装 |
| scripts/official-web-clients.mjs | 从锁定官方base/Web及dsh.client元数据核对完整官方客户端 |
| scripts/install-preview.mjs | 安装完整官方个人Web及显式开发功能组合 |
| enterprise/README.md | 单ECS按账号进程的实施与验收边界 |

企业身份、协作和通知显式外置，不进入个人或Desktop默认包。共同功能复用包、服务和页面；企业运行只在 Desktop 本机；workdsh-admin 负责账号、组织、授权、协作数据与模型转发。

Profile是插件/配置选择，不是账号；企业账号分别拥有数据、配置、凭据和文件，同账号多浏览器登录复用进程。旧共享多人Host清单与成员Context装配已退役，不作为另一条企业路线。

个人preview和企业候选已显示0.2.0-rc.2；实际验收见 [STATUS](../apps/web/docs/ACCEPTANCE.md)。Desktop运行版本与打包门禁未完成，不以源码目标或Web证据代替。
