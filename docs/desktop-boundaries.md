# Desktop and WorkDSH ownership

Desktop is one Electron carrier around an unmodified DeepSeek Harness
installation. That installation supplies the official Host, complete Web Client
and Agent execution. The carrier contains no DSH runtime dependencies in
`app.asar`. The bundled primary runtime supplies Node; packaging must not add a
second Node or DSH installation to the carrier.

Personal and enterprise Desktop execute DSH and local tools on the user's
computer. Enterprise Web retains its ECS account processes. Model inference and
remote MCP calls execute at their respective services. Desktop login must not
start a server-side member DSH process.

## Official version

The product target and Desktop pin are **DSH 0.2.0-rc.2**, selected explicitly
by the user. A pin change does not upgrade already installed applications or
Profiles. Version alignment, Desktop checks and packaged-runtime verification
must pass before an upgrade is declared complete. Stable releases remain the
default policy; pre-releases require a product decision. Platform installation
and graphical acceptance are separate from headless checks.

## Plugin delivery

The built-in owned feature plugins are **experts, library, skills and
MCP/connectors**. This does not preinstall every expert definition, skill or MCP
server. The enterprise account plugin is additionally carried by the immutable
runtime and selected only after enterprise login. Personal defaults and the
personal plugin inventory do not enable it; employees do not install an account
tgz. Projects, WorkDSH Office, activity, collaboration, notifications and other
business applications remain external plugins requiring explicit installation.
Official runtime plugins and primary-runtime Office skills are separate
infrastructure, not the WorkDSH Office feature package.

`dsh-plugin-desktop/scripts/workdsh-package-boundary.mjs` owns the release
inventory: four feature packages, the enterprise account package, and the
required local identity, browser-session, access, audit and composition packages.
SkillHub 0.2.16 and dshmarket 1.66.1 retain the existing third-party catalog integration in this same Profile. Catalog entries remain separately installed and subject to compatibility checks.
The five support packages are activated by the default Profile patch; they are
not additional manageable product bundles. The enterprise account patch is
selected by enterprise mode, never by the personal default patch.

`profile-installation.json` is generated from that single installed manifest.
It exposes support and enterprise packages as peers for the official Profile
resolver, while the official plugin manager lists selected bundles and
dependencies. It points at the same installation tree; it is not another runtime
installation or a separately maintained product selection.

## Administrator deployment configuration

`WORKDSH_DEPLOYMENT_CONFIG` selects an administrator-owned packaging input. Its
only supported setting is `enterprise.backendUrl`. Before packaging, the input
is validated and a fresh `workdsh-config.json` is written to application resources;
without an input, the resource is `{}`. Previous company configuration must not
leak into a subsequent package.

A company package fixes the backend origin. Main uses it ahead of saved values,
entry form values or page parameters. Employees cannot redirect that package's
login to another backend. HTTPS certificate validation remains enabled; HTTP is
accepted only for loopback development. Deployment configuration never contains
passwords, member tokens, server service keys or model credentials. See the
[personal and enterprise guide](DESKTOP-PERSONAL-ENTERPRISE.md) for administrator
and employee steps.

## Runtime and writable Profiles

Release preparation uses fresh archives from the unique WorkDSH source.
`pack-workdsh-profile.mjs` records package versions and hashes;
`prepare-workdsh-runtime.mjs` verifies the DSH target, archive set, hashes and
dependency closure. It does not copy a running Profile. Archives and lockfile
paths remain relative inside release resources. Official package operations use
the pinned pnpm JavaScript CLI and the same bundled Node. The version gate checks
all installed official DSH instances, including transitive pnpm instances.

Profile preparation boots the actual official plugin manager. Its personal
default inventory contains exactly the four enabled WorkDSH feature bundles.
The Electron `afterPack` gate repeats this check with packaged resources and
bundled Node, verifies archive and deployment configuration integrity, and
rejects a second runtime tree. These checks do not substitute for real windows,
model conversations, local tools or platform installer acceptance.

Each writable personal or member Profile owns its configuration, selected
plugins and lockfile. The official installation anchor supplies common immutable
dependencies, including the account plugin when enterprise mode selects it.
Explicitly installed packages resolve from the writable Profile. A new writable
Profile has an empty dependency map and no `node_modules`; it does not inherit
the release graph or lockfile. Restart and base upgrades preserve user
configuration and installed plugins without writing through shared runtime
links. Unsupported Profiles without ownership records are not automatically
rewritten.

A Profile is configuration composition, not a user account or authorization
boundary. Enterprise local storage is separated by verified backend, organization
and member. Separate directories do not provide an operating-system sandbox.
Main owns backend authentication; business windows do not receive the backend
bearer. The enterprise plugin uses a restricted local interface for account,
logout and visible-body synchronization. Supplier model keys stay on the server;
users configure internal model API credentials through the official settings.

Desktop owns entry, packaging, process and window lifecycle. WorkDSH packages
own shared business services and pages; enterprise adapters own member identity
and synchronization. The backend owns server authorization and organization
services. New features extend these boundaries instead of copying personal,
Web or Desktop implementations. Company packaging and member flows are described
in the [Desktop connection guide](DESKTOP-PERSONAL-ENTERPRISE.md).
