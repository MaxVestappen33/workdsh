# WorkDSH FAQ

[中文](faq.md)

## Is this an official DeepSeek product?

No. WorkDSH is an independent community project built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and is not officially endorsed.

## Which platforms are supported?

Check the actual assets attached to [GitHub Releases](https://github.com/techflag/workdsh/releases). Current build targets are Windows x64 and separate macOS arm64 and x64 packages. There is no Universal or Linux installer.

## Must I install Node.js, Python, or DSH myself?

Ordinary users do not. The installer includes a pinned runtime and DSH Profile. Developers building from source need the repository's required Node.js and package manager.

## Is official Harness modified?

No. The repository pins official published packages and Desktop release archives, without building official source. The Electron carrier starts that DSH Profile, and WorkDSH features are composed by Profile packages.

## Where are data and plugins?

DSH home is under local application data. Library, experts, skills and MCP/connectors ship by default. The enterprise account plugin ships with the runtime and activates only after enterprise login. Other owned features require explicit external plugin installation. SkillHub and dshmarket provide third-party skill and plugin catalogs; catalog entries are not all preinstalled. Whether an external model receives data depends on user configuration.

## How do I update?

The current carrier has no automatic update manager. Download a newer installer manually from [Releases](https://github.com/techflag/workdsh/releases), backing up important data first. Report problems through [GitHub Issues](https://github.com/techflag/workdsh/issues).
