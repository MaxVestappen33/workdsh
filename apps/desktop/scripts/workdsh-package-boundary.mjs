// Review this inventory when the WorkDSH release adds or removes a package.
// Only product packages are selected or exposed by the default personal Profile.
export const PRODUCT_PACKAGES = Object.freeze([
  'workdsh-plugin-connectors',
  'workdsh-plugin-experts',
  'workdsh-plugin-library',
  'workdsh-plugin-model-market',
  'workdsh-plugin-projects',
  'workdsh-plugin-prompts',
  'workdsh-plugin-skills',
  'workdsh-plugin-workbenches',
])

// External enterprise packages: installed explicitly, never included in the base installer.
export const ENTERPRISE_PACKAGES = Object.freeze([
  'workdsh-provider-identity-enterprise',
  'workdsh-plugin-enterprise-collaboration',
  'workdsh-enterprise-connection',
])

// Keep the already shipped community catalog integrations on the same Profile.
export const CATALOG_PACKAGES = Object.freeze({
  '@cocofhu/skillhub': '0.2.16',
  dshmarket: '1.66.8',
})

// Third-party plugin bundles installed into the immutable runtime at build time,
// so a new Profile shows their pages on first launch without any registry access.
// Their own `dsh.bundle.patch` supplies the Loader entries; never copy those rows
// into the Profile patch, which would duplicate entry ids.
export const BUILTIN_BUNDLES = Object.freeze({
  'dsh-mnemon': '0.5.36',
})

// Loader ids each built-in bundle must contribute to the default composition.
export const BUILTIN_BUNDLE_ENTRIES = Object.freeze({
  'dsh-mnemon': Object.freeze([
    'mnemon-bundle',
    'mnemon',
    'mnemon-source-runtime',
    'mnemon-source-documents',
    'mnemon-source-memory-spaces',
    'mnemon-strategy-default-three-tier',
  ]),
})

export const RELEASE_PACKAGES = Object.freeze([
  'workdsh-contracts',
  'workdsh-ui',
  'workdsh-provider-identity-local',
  'workdsh-provider-identity-account',
  'workdsh-provider-backend-channel',
  'workdsh-provider-browser-session',
  'workdsh-plugin-audit',
  'workdsh-plugin-access',
  'workdsh-plugin-account-settings',
  'workdsh-plugin-skills',
  'workdsh-plugin-experts',
  'workdsh-plugin-connectors',
  'workdsh-plugin-library',
  'workdsh-bundle',
  'workdsh-plugin-projects',
  'workdsh-plugin-model-market',
  'workdsh-plugin-prompts',
  'workdsh-plugin-workbenches',
])

export const PACKAGE_DIRECTORIES = Object.freeze({
  'workdsh-contracts': '../../packages/contracts',
  'workdsh-ui': '../../packages/ui',
  'workdsh-provider-identity-local': '../../packages/providers/identity-local',
  'workdsh-provider-identity-account': '../../packages/providers/identity-account',
  'workdsh-provider-backend-channel': '../../packages/providers/backend-channel',
  'workdsh-provider-browser-session': '../../packages/providers/browser-session',
  'workdsh-plugin-audit': '../../packages/plugins/audit',
  'workdsh-plugin-access': '../../packages/plugins/access',
  'workdsh-plugin-account-settings': '../../packages/plugins/account-settings',
  'workdsh-plugin-skills': '../../packages/plugins/skills',
  'workdsh-plugin-experts': '../../packages/plugins/experts',
  'workdsh-plugin-connectors': '../../packages/plugins/connectors',
  'workdsh-plugin-library': '../../packages/plugins/library',
  'workdsh-bundle': '../../packages/bundle',
  'workdsh-plugin-projects': '../../packages/plugins/projects',
  'workdsh-plugin-model-market': '../../packages/plugins/model-market',
  'workdsh-plugin-prompts': '../../packages/plugins/prompts',
  'workdsh-plugin-workbenches': '../../packages/plugins/workbenches',
  'workdsh-provider-identity-enterprise': '../../packages/providers/identity-enterprise',
  'workdsh-plugin-enterprise-collaboration': '../../packages/plugins/enterprise-collaboration',
})
