# WorkDSH Desktop carrier

[中文](README.zh.md)

This package builds the Electron application and contains one bundled personal runtime Profile. Official DeepSeek Harness owns the Host, full Web Client and core execution; WorkDSH feature packages supply shared experts, Skills, Library and MCP/connectors. These are the default owned feature boundary, not a promise that every definition or MCP service is preinstalled. The enterprise account plugin is carried in the immutable runtime and selected only after enterprise login; personal defaults do not activate it. Collaboration and notifications remain explicitly installed external plugins.

## Personal and enterprise connections

The carrier first shows a personal/enterprise chooser. Personal mode starts the personal local Home/Profile. The enterprise administrator fixes the company HTTPS backend origin when packaging; enterprise mode authenticates the verified organization/member in Main; HTTP is allowed only for loopback development. It then runs the same official DSH locally in the member's separate space, rather than opening remote enterprise Web. Enterprise Web continues to run per-account processes on ECS.

The enterprise account plugin loads from the packaged official dependency graph without an employee tgz installation step. A missing, incompatible or member-local shadowing package prevents enterprise startup. Personal defaults do not select enterprise identity; collaboration and notifications are not automatically installed. Backend, organization and member determine separate configuration, credentials, skill roots and window storage, while both modes use the same official client, settings and right panel. This change supplies account/body adapters without automatically installing collaboration or notifications.

The backend bearer stays in Main memory; business pages and the DSH CLI never receive it. A controlled loopback interface rechecks the fixed account for each operation and exposes only account, logout and visible-body synchronization. The plugin reuses its account page, showing the organization name, sync status, retry/delete and logout.

Logout first stops admission, then stops the owned local DSH/tool processes and clears authentication files and enterprise window storage. Remote revocation failure still stops local execution and reports the unconfirmed revocation; personal and member data remain. Quitting during other plugin installation cancels the owned installer, and startup failure leaves no authentication bridge. Separate directories are not an operating-system security sandbox.

Members configure the internal model address, Key, protocol and models manually in the official Custom Model API page. The management service supplies Spring AI forwarding and organization authorization; the carrier injects no provider and replaces no settings page. The enterprise plugin uploads committed visible body only, excluding tools, thinking, unshared files and credentials. Administrators read their organization's body with access auditing. This is not complete or tamper-proof endpoint auditing.

The enterprise administrator copies `config/enterprise.example.json`, sets the backend address, and packages the application:

```json
{"enterprise":{"backendUrl":"https://workdsh.company.com"}}
```

```sh
WORKDSH_DEPLOYMENT_CONFIG=/absolute/path/company.json corepack yarn package:dir
```

Packaging writes the validated configuration to `workdsh-config.json` in application Resources. Employees see the fixed address and cannot override it. Only `enterprise.backendUrl` is accepted; passwords and Keys are rejected. Personal builds without this environment variable generate empty configuration and cannot inherit a previous company's address. Development uses `corepack yarn dev` with manual setup or `WORKDSH_ENTERPRISE_PORTAL` prefill; this is not the managed deployment configuration.

## Development and validation

Use Node.js `^22.19.0` or `>=24` and Corepack Yarn 4.18.0. At the repository root:

```sh
corepack yarn install --immutable
corepack pnpm --dir workdsh-web build
node apps/desktop/scripts/pack-workdsh-profile.mjs workdsh-web
corepack yarn dev
```

`dev` builds the carrier, prepares its pinned Profile and primary runtime, then launches Electron. Keep graphical launch explicit. Headless verification uses:

```sh
corepack yarn test
corepack yarn typecheck
corepack yarn check:bilingual-docs
corepack yarn check:desktop-dsh-alignment
```

`corepack yarn check` is the full headless gate. `corepack yarn workspace dsh-plugin-desktop package:dir` creates an unpacked application and checks for duplicate DSH trees. Unit tests use a mocked Electron lifecycle; they do not establish real window, packaged-runtime or server acceptance.

`corepack yarn release:pack` builds and packages the same commit's Web sources and the reviewed Desktop composition, preserving the clean-source release gate. The Web release directory also receives `desktop-release-manifest.json` and its hash-named archives for published Desktop packaging.

Build the four owned features, their required support packages and the enterprise account package in WorkDSH first. `pack-workdsh-profile.mjs` creates immutable archives and a version/hash manifest in `build/workdsh-profile-release`; select another candidate with `WORKDSH_RELEASE_DIRECTORY`. Runtime preparation installs the official version with a portable lockfile and carries pnpm's JavaScript CLI for explicit plugin operations. It rejects additional default feature packages and verifies the real plugin manager exposes exactly four WorkDSH bundles. The same Profile preserves the pinned SkillHub 0.2.16 and dshmarket 1.66.1 catalog integrations. Their catalog entries are not all installed or reviewed by WorkDSH. It does not package a live user's configuration or credentials.

The Desktop pin and shared product target are **DSH 0.2.0-rc.2**, selected explicitly by the user. The unmodified official `dsh-v0.2.0-rc.2` tag pins commit `639ed015397290b3745d163aafe02ffee4aa3f84`. Existing installed applications and Profiles have their own actual versions. Desktop alignment, Desktop checks and packaged-runtime acceptance must pass before declaring the unified upgrade complete; Web Docker evidence cannot replace those gates. Prefer validated official stable releases by default.

The upstream checkout remains read-only. The carrier source and packaging scripts live here; feature package source belongs to WorkDSH, and the server launcher/gateway recipe is owned by its deploy/member-process directory. See [Desktop ownership](../../docs/desktop-boundaries.md).
