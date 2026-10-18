# WorkDSH Desktop carrier

[中文](README.zh.md)

This package builds the Electron application and contains one bundled personal runtime Profile. Official DeepSeek Harness owns the Host, full Web Client and core execution; shared WorkDSH feature packages supply the product capabilities selected by the reviewed Profile. This does not preinstall every expert definition, Skill or MCP service. Enterprise identity and collaboration are installed explicitly as external plugins and are not included in the base installer. Notifications and independent business applications are also optional external plugins.

## Personal and enterprise connections

The carrier first shows a personal/enterprise chooser. Personal mode starts the personal local Home/Profile. The enterprise administrator fixes the company HTTPS backend origin when packaging; enterprise mode authenticates the verified organization/member in Main; HTTP is allowed only for loopback development. It then runs the same official DSH locally in the member's separate space, rather than opening remote enterprise Web. Enterprise execution remains on the employee's Desktop; the server provides accounts, authorization, collaboration data and model forwarding.

Install and activate the Enterprise Connection archive in the personal space before company login. Missing or incompatible enterprise packages prevent enterprise startup. Backend, organization and member determine separate configuration, credentials, skill roots and window storage; both modes use the same official client, settings and right panel. Installing a plugin does not grant membership or business permissions; the backend verifies them.

The backend bearer stays in Main memory; business pages and the DSH CLI never receive it. A controlled loopback interface rechecks the fixed account for each operation and exposes only account, logout and visible-body synchronization. The plugin reuses its account page, showing the organization name, sync status, retry/delete and logout.

Logout first stops admission, then stops the owned local DSH/tool processes and clears authentication files and enterprise window storage. Remote revocation failure still stops local execution and reports the unconfirmed revocation; personal and member data remain. Quitting during other plugin installation cancels the owned installer, and startup failure leaves no authentication bridge. Separate directories are not an operating-system security sandbox.

Members configure the internal model address, Key, protocol and models manually in the official Custom Model API page. The management service supplies Spring AI forwarding and organization authorization; the carrier injects no provider and replaces no settings page. The enterprise plugin uploads committed visible body only, excluding tools, thinking, unshared files and credentials. Administrators read their organization's body with access auditing. This is not complete or tamper-proof endpoint auditing.

The enterprise administrator copies `config/enterprise.example.json`, sets the backend address, and packages the application:

```json
{"enterprise":{"backendUrl":"https://workdsh.company.com"}}
```

```sh
WORKDSH_DEPLOYMENT_CONFIG=/absolute/path/company.json corepack yarn workspace dsh-plugin-desktop package:dir
```

Packaging writes the validated configuration to `workdsh-config.json` in application Resources. Employees see the fixed address and cannot override it. Only `enterprise.backendUrl` is accepted; passwords and Keys are rejected. Personal builds without this environment variable generate empty configuration and cannot inherit a previous company's address. Development uses `corepack yarn dev` with manual setup or `WORKDSH_ENTERPRISE_PORTAL` prefill; this is not the managed deployment configuration.

## Development and validation

Use Node.js `^22.19.0` or `>=24` and Corepack Yarn 4.18.0. At the repository root:

```sh
corepack yarn install --immutable
corepack pnpm --dir apps/web install --frozen-lockfile
corepack pnpm --dir apps/web build
node apps/desktop/scripts/pack-workdsh-profile.mjs apps/web
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

Build the shared features and their required support packages first. `pack-workdsh-profile.mjs` creates immutable archives and a version/hash manifest in `build/workdsh-profile-release`; select another candidate with `WORKDSH_RELEASE_DIRECTORY`. Runtime preparation installs the official version with a portable lockfile and carries pnpm's JavaScript CLI for explicit plugin operations. The package inventory in `scripts/workdsh-package-boundary.mjs` defines the reviewed default bundles and required support packages; enterprise plugins are excluded from the base installer. The same Profile preserves the pinned SkillHub 0.2.16 and dshmarket 1.66.8 catalog integrations. Their catalog entries are not all installed or reviewed by WorkDSH. It does not package a live user's configuration or credentials.

`upstream.json` locks Desktop and Web to the same official **DSH 0.2.1-rc.1** release, as explicitly required by the user. Published packages and checksum-locked official Desktop archives supply the runtime; product builds do not import or compile official source. Existing applications and Profiles have their own actual versions. Alignment, Desktop checks and packaged-runtime acceptance must pass before declaring an upgrade complete; Web preview evidence cannot replace them. Prefer validated official stable releases by default.

The carrier source and packaging scripts live here; shared WorkDSH feature sources live under the repository's `packages/`. Official DSH packages are consumed without a source checkout. Enterprise administration and model forwarding belong to the separate WorkDSH Admin repository. See [Desktop ownership](../../docs/desktop-boundaries.md).
