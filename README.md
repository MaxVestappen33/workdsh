<p align="center"><img src="workdsh-web/assets/brand/workdsh-logo.svg" width="88" alt="WorkDSH logo"></p>
<h1 align="center">WorkDSH</h1>
<p align="center"><strong>A WorkBuddy-style workspace where skills, experts, and plugins shape new workflows.</strong></p>
<p align="center">WorkDSH brings material, experts, skills, and connectors into one workspace, with the SkillHub catalog and installable DSH community plugins.</p>
<p align="center"><a href="#download-desktop">Download Desktop</a> · <a href="#from-material-to-deliverable">Explore the workflow</a> · <a href="#personal-and-enterprise-use">Personal and enterprise</a> · <a href="docs/user-guide.en.md">User guide</a> · <a href="README.zh-CN.md">简体中文</a></p>

[![Desktop release](https://img.shields.io/badge/Desktop-2.0.6--alpha.1-176BFF)](https://github.com/techflag/workdsh/releases/tag/desktop-v2.0.6-alpha.1) [![GitHub stars](https://img.shields.io/github/stars/techflag/workdsh?label=stars)](https://github.com/techflag/workdsh) [![MIT License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

![WorkDSH projects home with project templates and the complete desktop sidebar](workdsh-web/assets/screenshots/workdsh-projects-alpha8-dark.png)

<sub>Captured from a local WorkDSH session. Project names and account figures are demonstration data, not bundled with the installer.</sub>

## A WorkBuddy-style experience, an open DSH ecosystem

WorkDSH draws on WorkBuddy's way of organizing projects, material, experts, skills, and connectors, and implements those pages and management features on DeepSeek Harness. DSH is a complete agent application in its own right; it composes models, tools, skill support, and UI through plugins. WorkDSH adds its workspace features through the same mechanism.

| What you need to do | Where WorkDSH helps |
| --- | --- |
| Keep working toward a long-term goal | **Projects** bring instructions, plans, tasks, material, and capability settings together. |
| Give AI the files you already have | The **library** manages local files, search, and previews; tasks can reference material and its revision. |
| Reuse a team's working methods | **Experts** save role and capability settings; **skills** carry callable instructions and resources. |
| Keep the result beyond the chat | The **deliverable workspace** previews or edits supported working copies of documents, spreadsheets, presentations, HTML, and PDF. |

### From material to deliverable

```text
File in library ──reference──> Project task ──choose──> Expert / Skill / Connector
                                            │
                                            └──> Inspect the process and result; keep editing in supported editors
```

This path is WorkDSH's product direction. End-to-end validation of project document references, expert execution, and different Office formats is ongoing during Alpha. Preview, editing, and export fidelity differ by format; the [current capabilities and limits](workdsh-web/README.md) describe them in more detail.

<details>
<summary>See an HTML deliverable from a real local conversation</summary>

![WorkDSH conversation, deliverable cards, and right-side HTML preview](workdsh-web/assets/screenshots/workdsh-html-dashboard-preview.png)

<sub>A local task example showing deliverable cards and right-side preview; it does not imply lossless editing for every file.</sub>

</details>

## Skills and plugins

It helps to distinguish **the content people use** from **the software extension that manages it**. A skill usually consists of instructions and resources containing `SKILL.md`; it can be installed directly into the local DSH Skills directory and is not necessarily a plugin. WorkDSH's skill manager is a DSH plugin. An expert configuration is not itself a plugin either; a WorkDSH plugin manages experts. Other DSH plugins can add tools or UI features directly. The plugin system can therefore support skills, experts, and software functions without making every skill or expert a separate plugin.

DSH plugins can be individual tools or combine UI, services, and other resources into a larger application scenario. For example, a data-management plugin could add data views and processing tools, then work with skills and experts across a workflow. This illustrates what the plugin model can support; it does not mean this release bundles such a data-management system. Users can discover and install skills through SkillHub and find DSH community plugins through dsh-market. Before installing a plugin, check what it provides and whether it supports the current DSH version.

WorkDSH connects two independently maintained catalogs: [SkillHub](https://skillhub.cn/) for Skills and [dsh-market](https://dshmarket.com/zh/) for DSH plugins. SkillHub entries show their source and version, and open the source page for license information before installation. The DSH catalog is provided by the third-party dsh-market plugin inside the existing plugin page. Catalog entries are **not all preinstalled, reviewed, or endorsed by WorkDSH**; check each item's license, dependencies, and DSH compatibility. [Skill management](workdsh-web/packages/plugins/skills/README.md) · [Plugin development](docs/plugin-development.en.md) · [Ecosystem manifesto](docs/plugin-ecosystem.en.md)

![SkillHub catalog inside WorkDSH, showing skill icons, versions, sources, and install actions](workdsh-web/assets/screenshots/workdsh-skillhub-2026-09.png)

<sub>Live SkillHub results; catalog size and entries change over time. The local session shown is a demonstration environment.</sub>

![DSH community plugin catalog opened from WorkDSH's existing plugin page](workdsh-web/assets/screenshots/workdsh-dshmarket-2026-09.png)

<sub>The third-party dsh-market plugin supplies discovery and installation. The screenshot does not imply that catalog plugins are bundled with WorkDSH.</sub>

## Personal and enterprise use

WorkDSH supports personal use, Enterprise Web and Enterprise Desktop. Personal and enterprise modes use the complete official DSH interface and the same WorkDSH feature packages. [WorkDSH Admin](https://github.com/techflag/workdsh-admin) manages company accounts, organizations, permissions and internal model APIs.

| Mode | Where the Agent and tools run | How to enter |
| --- | --- | --- |
| Personal Desktop | On your computer, using personal files and model settings. | Open the app and choose personal use. |
| Enterprise Desktop | On the employee's computer, using local files and tools. | Install the company-provided desktop app and choose enterprise login. |
| Enterprise Web | A separate account process on the company's ECS server. | Open the company Web address and sign in. |

Desktop keeps personal and enterprise data and credentials in separate spaces. The enterprise account plugin is included in Desktop and activates only in enterprise mode; members do not need to install it separately. Collaboration, notifications and business applications remain independently installed plugins.

### Enterprise login and account

The company administrator presets the backend address in the Desktop package. Employees sign in with their own company accounts after installation. Enterprise Web uses the Web address provided by the administrator.

![Desktop personal and enterprise entry](assets/screenshots/desktop-login.png)

<sub>The enterprise screenshots in this section use demonstration accounts, organizations and local addresses. This sample data is not shipped with the app.</sub>

After signing in, use **Settings → Enterprise account** to view your name, organization and role, or sign out.

<details>
<summary>See the enterprise account and sign-out entry</summary>

![Enterprise Desktop account](assets/screenshots/enterprise-account.png)

</details>

Enterprise Desktop synchronizes visible user and assistant conversation text to the backend under the member's account. Thinking, tool traces and attachments are not uploaded as conversation text. Authorized administrators can read their organization's synchronized text through audited, read-only access.

### Configure company models

An administrator configures upstream model APIs, supplier keys, protocols and allowed model catalogs in WorkDSH Admin. Members receive an internal API address and access key, then use **Settings → Models → Custom model API**:

| Field | What to enter |
| --- | --- |
| Provider ID and display name | For example, `company-api` and `Company models`. |
| API address | The administrator's internal base URL, for example `https://enterprise.example/api/model-gateway/v1`. |
| API protocol | The protocol supported by that internal endpoint. |
| API key | The internal access key supplied by the administrator. |
| Model catalog | Fetch available models, or add the allowed model IDs provided by the administrator. |

Save the provider and select its model in the conversation. Personal model providers can coexist with the company provider. Real supplier keys stay on the server; company providers are configured through the official settings rather than automatically injected into DSH. Model requests go to the configured API independently of where the Agent runs.

<details>
<summary>See company model configuration in the official settings</summary>

![Enterprise Desktop company model settings](assets/screenshots/company-model.png)

</details>

<details>
<summary>See the Enterprise Web workspace, Skills and admin console</summary>

Enterprise Web — conversation workspace:

![Enterprise Web conversation workspace](assets/screenshots/enterprise-web.jpg)

Enterprise Web — Skills:

![Enterprise Web Skills](assets/screenshots/skills.jpg)

WorkDSH Admin — organization overview:

![WorkDSH Admin organization overview](assets/screenshots/admin-overview.jpg)

</details>

## Download Desktop

The planned desktop installer release is **2.0.6-alpha.1**. Its download links will become available after the [GitHub Release](https://github.com/techflag/workdsh/releases/tag/desktop-v2.0.6-alpha.1) is published:

| Platform | Download |
| --- | --- |
| Windows x64 | [WorkDSH Setup.exe](https://github.com/techflag/workdsh/releases/download/desktop-v2.0.6-alpha.1/dsh-plugin-desktop-windows-x64--WorkDSH-2.0.6-alpha.1-x64-Setup.exe) |
| macOS Apple Silicon | [WorkDSH arm64.dmg](https://github.com/techflag/workdsh/releases/download/desktop-v2.0.6-alpha.1/dsh-plugin-desktop-macos-arm64--WorkDSH-2.0.6-alpha.1-arm64.dmg) |
| macOS Intel | [WorkDSH x64.dmg](https://github.com/techflag/workdsh/releases/download/desktop-v2.0.6-alpha.1/dsh-plugin-desktop-macos-x64--WorkDSH-2.0.6-alpha.1-x64.dmg) |

Desktop installers include Node.js and Python runtimes by default, so users do not need to install them separately. This is an **Alpha release**: end-to-end project document references, expert execution, and different Office formats are still being validated. The macOS DMGs are unsigned; download updates from [Releases](https://github.com/techflag/workdsh/releases). Start with the [user guide](docs/user-guide.en.md) and [FAQ](docs/faq.en.md).

Enterprise Desktop uses a company-provided package that includes the enterprise entry. For existing downloads, available features are described in their corresponding release notes.

## Development and documentation

Source ownership: [WorkDSH feature packages and Web](workdsh-web/README.md) · [Desktop carrier](dsh-plugin-desktop/README.md) · [Architecture](docs/architecture.en.md) · [All documentation](docs/README.en.md). Running from source requires Node.js 22.19+ or 24+, Corepack, and Yarn 4.18.0:

```sh
corepack yarn install --immutable
corepack yarn dev
```

Run checks with `corepack yarn check`. On macOS or Windows, `corepack yarn release:pack` builds the Web Profile and Desktop package from the current commit. Once the Web package is published, use `corepack yarn release:pack:published` for the final installer. Both commands share the same [packaging script](scripts/package-desktop-release.mjs). [Contributing](CONTRIBUTING.en.md)

The desktop Tools menu manages the bundled `dsh` command (inspect, install, repair, remove), using the packaged Node, pnpm and official CLI. Commands display the active Desktop space; use `--workdsh-space=personal` or `--workdsh-space=enterprise` to select it explicitly. Initialize the space in Desktop first and keep Desktop signed in for enterprise operations. Plugin changes apply to that space’s Profile.

The official DSH core uses published npm packages. Desktop Node, pnpm, Python, Office resources and command helpers are extracted from official installers. `upstream.json` locks their version, URLs, sizes and SHA-512 digests; no official source checkout is required. Initial packaging downloads the platform release. Windows build machines require 7-Zip to extract the installer.

### Enterprise Desktop packaging configuration

After deploying [WorkDSH Admin](https://github.com/techflag/workdsh-admin), the company administrator provides the public backend address when packaging Desktop. The configuration file contains only the address, for example:

```json
{
  "enterprise": {
    "backendUrl": "https://enterprise.example"
  }
}
```

Set `WORKDSH_DEPLOYMENT_CONFIG` to this file. Packaging writes it to `workdsh-config.json` in application resources, and the employee entry uses the fixed address. Model API addresses and internal access keys are configured in the official model settings, outside the packaging configuration. See the [Desktop packaging instructions](dsh-plugin-desktop/README.md).

## Community and acknowledgements

Thanks to the maintainers and contributors of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the foundation of our runtime and plugin system; [Tencent SkillHub](https://github.com/Tencent/skillhub), whose public catalog API powers skill discovery; [@cocofhu/skillhub](https://github.com/cocofhu/skillhub), the bundled DSH SkillHub plugin; and [dsh-market](https://github.com/dsh-market/dsh-market) with the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog, which power community plugin discovery. WorkBuddy inspired the workspace design. The bundled skill-creator adaptation retains its [Apache-2.0 notice](workdsh-web/packages/plugins/skills/resources/skills/workdsh-skill-creator/NOTICE.md). Feedback and contributions: [GitHub Issues](https://github.com/techflag/workdsh/issues) · [Contributing](CONTRIBUTING.en.md)

WorkDSH uses the [MIT License](LICENSE). It is an independent community project and is not affiliated with, partnered with, authorized by, or endorsed by DeepSeek or WorkBuddy. Those names appear only to describe technical origins, compatibility, and design references. Upstream contributors shown on GitHub are inherited from synchronized commit history; this does not imply that they maintain this repository.

## Star history

[![WorkDSH star history](https://api.star-history.com/chart?repos=techflag/workdsh&type=date)](https://www.star-history.com/?repos=techflag%2Fworkdsh&type=date)
