import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { requiredRuntimeDependencies, composeProfilePatches, verifyBuiltPackageExports, verifyDefaultComposition, verifyDefaultProfile, verifyInstalledDshVersions, verifyPackageDshReferences, verifyProfileRelease, verifyReleaseArchives } from './verify-profile-release.mjs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DSH_VERSION } from './runtime-version.mjs'
import { ENTERPRISE_PACKAGES, PRODUCT_PACKAGES, RELEASE_PACKAGES } from './workdsh-package-boundary.mjs'

test('release bootstrap installs dependencies before loading package validators', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workdsh clean release '))
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  try {
    for (const relative of [
      'scripts/package-desktop-release.mjs',
      'apps/desktop/scripts/runtime-version.mjs',
      'apps/desktop/scripts/workdsh-package-boundary.mjs',
      'apps/desktop/scripts/verify-profile-release.mjs',
      'upstream.json',
    ]) {
      const destination = join(directory, relative)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(join(root, relative), destination)
    }
    const shimDirectory = join(directory, 'bin')
    mkdirSync(shimDirectory)
    const marker = join(directory, 'install-args.json')
    const worker = join(directory, 'corepack-worker.mjs')
    writeFileSync(worker, "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.WORKDSH_TEST_MARKER, JSON.stringify(process.argv.slice(2))); process.exit(42)\n")
    const shim = join(shimDirectory, process.platform === 'win32' ? 'corepack.cmd' : 'corepack')
    writeFileSync(shim, process.platform === 'win32'
      ? '@"%WORKDSH_TEST_NODE%" "%WORKDSH_TEST_COREPACK%" %*\r\n'
      : '#!/bin/sh\nexec "$WORKDSH_TEST_NODE" "$WORKDSH_TEST_COREPACK" "$@"\n')
    if (process.platform !== 'win32') chmodSync(shim, 0o755)
    const preload = join(directory, 'test-platform.mjs')
    writeFileSync(preload, "if (process.platform === 'linux') Object.defineProperty(process, 'platform', { value: 'darwin' })\n")
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(directory, 'scripts/package-desktop-release.mjs'), '--source=local'], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${shimDirectory}${delimiter}${process.env.PATH ?? ''}`,
        WORKDSH_TEST_NODE: process.execPath,
        WORKDSH_TEST_COREPACK: worker,
        WORKDSH_TEST_MARKER: marker,
      },
    })
    assert.ifError(result.error)
    assert.match(result.stderr, /Install Desktop dependencies failed with exit code 42/)
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['yarn', 'install', '--immutable'])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('accepts a WorkDSH release aligned with the pinned DSH runtime', () => {
  assert.doesNotThrow(() => verifyProfileRelease({
    harness: DSH_VERSION,
    runtimeOverrides: { '@deepseek-ai/dsh': DSH_VERSION, 'other-package': '1.0.0' },
  }, DSH_VERSION))
})

test('rejects an older WorkDSH release instead of relabeling its compatibility', () => {
  assert.throws(() => verifyProfileRelease({ harness: 'obsolete-dsh-version' }, DSH_VERSION), /targets DSH/)
  assert.throws(() => verifyProfileRelease({
    harness: DSH_VERSION,
    runtimeOverrides: { '@deepseek-ai/dsh-agent': 'obsolete-dsh-version' },
  }, DSH_VERSION), /overrides @deepseek-ai\/dsh-agent/)
})

test('rejects a WorkDSH package built against another DSH version', () => {
  assert.doesNotThrow(() => verifyPackageDshReferences({
    name: 'workdsh-plugin-experts',
    peerDependencies: { '@deepseek-ai/dsh-agent': DSH_VERSION },
  }, DSH_VERSION))
  assert.throws(() => verifyPackageDshReferences({
    name: 'workdsh-plugin-experts',
    peerDependencies: { '@deepseek-ai/dsh-agent': '0.1.6-alpha.1' },
  }, DSH_VERSION), /workdsh-plugin-experts references @deepseek-ai\/dsh-agent/)
})

test('requires release package changes to be reviewed before Desktop bundles them', () => {
  assert.doesNotThrow(() => verifyProfileRelease({
    harness: DSH_VERSION,
    packages: [{ name: 'workdsh-plugin-experts' }],
  }, DSH_VERSION, ['workdsh-plugin-experts']))
  assert.throws(() => verifyProfileRelease({
    harness: DSH_VERSION,
    packages: [{ name: 'workdsh-plugin-experts' }, { name: 'new-plugin' }],
  }, DSH_VERSION, ['workdsh-plugin-experts']), /package set changed/)
})

function defaultProfile() {
  return {
    dependencies: Object.fromEntries(PRODUCT_PACKAGES.map(name => [name, 'file:../cache.tgz'])),
    optionalDependencies: Object.fromEntries(RELEASE_PACKAGES.filter(name => !PRODUCT_PACKAGES.includes(name)).map(name => [name, 'file:../cache.tgz'])),
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...PRODUCT_PACKAGES] } },
  }
}

test('Desktop ships five default features, reviewed infrastructure and no preinstalled enterprise package', () => {
  assert.equal(PRODUCT_PACKAGES.length, 5)
  assert.deepEqual(ENTERPRISE_PACKAGES, ['workdsh-provider-identity-enterprise', 'workdsh-plugin-enterprise-collaboration', 'workdsh-enterprise-connection'])
  assert.equal(RELEASE_PACKAGES.length, 12)
  assert.doesNotThrow(() => verifyDefaultProfile(defaultProfile()))
  for (const name of ['workdsh-plugin-office', 'workdsh-plugin-notifications']) {
    const profile = defaultProfile()
    profile.optionalDependencies[name] = 'file:../external.tgz'
    assert.throws(() => verifyDefaultProfile(profile), /owned dependency closure changed/)
  }
})

test('enterprise delivery cannot activate or expose enterprise identity in the default personal composition', () => {
  const selected = defaultProfile()
  selected.dsh.profile.bundles.push(ENTERPRISE_PACKAGES[0])
  assert.throws(() => verifyDefaultProfile(selected), /selected features changed/)
  const exposed = defaultProfile()
  exposed.dependencies[ENTERPRISE_PACKAGES[0]] = exposed.optionalDependencies[ENTERPRISE_PACKAGES[0]]
  delete exposed.optionalDependencies[ENTERPRISE_PACKAGES[0]]
  assert.throws(() => verifyDefaultProfile(exposed), /direct features changed/)
  assert.doesNotThrow(() => verifyDefaultComposition('- id: workdsh-identity-local\n  name: workdsh-provider-identity-local\n'))
  assert.throws(() => verifyDefaultComposition('- insert:\n    - id: workdsh-identity-enterprise\n      name: workdsh-provider-identity-enterprise\n'), /active in the default personal composition/)
  assert.throws(() => verifyDefaultComposition('- name: workdsh-provider-identity-enterprise/desktop\n'), /active in the default personal composition/)
})

test('default Profile rejects a missing or duplicate feature and exposed infrastructure', () => {
  const missing = defaultProfile()
  missing.dsh.profile.bundles.pop()
  assert.throws(() => verifyDefaultProfile(missing), /selected features changed/)
  const duplicate = defaultProfile()
  duplicate.dsh.profile.bundles.push(PRODUCT_PACKAGES[0])
  assert.throws(() => verifyDefaultProfile(duplicate), /selected features changed/)
  const infrastructure = defaultProfile()
  infrastructure.dependencies['workdsh-plugin-access'] = infrastructure.optionalDependencies['workdsh-plugin-access']
  delete infrastructure.optionalDependencies['workdsh-plugin-access']
  assert.throws(() => verifyDefaultProfile(infrastructure), /direct features changed/)
})

test('release archives reject changed bytes and unsafe metadata before installation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workdsh-release-check-'))
  try {
    const bytes = Buffer.from('owned archive fixture')
    const item = { name: 'workdsh-plugin-experts', filename: 'experts.tgz', sha256: createHash('sha256').update(bytes).digest('hex') }
    writeFileSync(join(directory, item.filename), bytes)
    assert.doesNotThrow(() => verifyReleaseArchives({ packages: [item] }, directory))
    writeFileSync(join(directory, item.filename), 'changed archive')
    assert.throws(() => verifyReleaseArchives({ packages: [item] }, directory), /digest mismatch/)
    assert.throws(() => verifyReleaseArchives({ packages: [{ ...item, filename: '../experts.tgz' }] }, directory), /Invalid owned archive metadata/)
    assert.throws(() => verifyReleaseArchives({ packages: [{ ...item, sha256: '' }] }, directory), /Invalid owned archive metadata/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('installed version gate rejects an older transitive runtime behind an aligned root', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workdsh-installed-version-'))
  try {
    const root = join(directory, 'node_modules/@deepseek-ai/dsh')
    const nested = join(directory, 'node_modules/.pnpm/old-runtime/node_modules/@deepseek-ai/dsh-agent')
    mkdirSync(root, { recursive: true }); mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: DSH_VERSION }))
    writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-agent', version: DSH_VERSION }))
    assert.equal(verifyInstalledDshVersions(directory, DSH_VERSION), 2)
    writeFileSync(join(nested, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-agent', version: '0.1.7' }))
    assert.throws(() => verifyInstalledDshVersions(directory, DSH_VERSION), /dsh-agent is 0\.1\.7/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('validates conditional exports and locale patterns without accepting missing artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'export-map-'))
  try {
    mkdirSync(join(directory, 'dist')); mkdirSync(join(directory, 'locale'))
    writeFileSync(join(directory, 'dist/index.js'), '')
    writeFileSync(join(directory, 'dist/index.d.ts'), '')
    writeFileSync(join(directory, 'locale/en.json'), '{}')
    const pkg = { name: 'fixture', exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' }, './locale/*.json': './locale/*.json' } }
    assert.doesNotThrow(() => verifyBuiltPackageExports(pkg, directory))
    rmSync(join(directory, 'dist/index.js'))
    assert.throws(() => verifyBuiltPackageExports(pkg, directory), /Missing built export.*index.js/)
    writeFileSync(join(directory, 'dist/index.js'), '')
    rmSync(join(directory, 'locale/en.json'))
    assert.throws(() => verifyBuiltPackageExports(pkg, directory), /Missing built export.*locale/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})


test('cross-architecture macOS runtime installs target native dependencies as well as host', async () => {
 const {runtimeArchitecture,runtimeArchitectureYaml}=await import('./runtime-architecture.mjs');
 const target=runtimeArchitecture({WORKDSH_MAC_ARCH:'x64'},'darwin','arm64');
 assert.deepEqual(target.cpus,['arm64','x64']);
 assert.equal(target.targetArch,'x64');
 assert.match(runtimeArchitectureYaml(target),/cpu:\n    - arm64\n    - x64/);
 assert.deepEqual(runtimeArchitecture({},'win32','x64').cpus,['x64']);
 assert.throws(()=>runtimeArchitecture({WORKDSH_MAC_ARCH:'invalid'},'darwin','arm64'),/Unsupported/);
});

test('composes populated and empty owned overlays into one valid patch document', () => {
  const result = composeProfilePatches(['- insert:\n    - id: first\n      name: fixture-first\n', '# client-only provider\n[]\n', '', '- insert:\n    - id: last\n      name: fixture-last\n'])
  assert.match(result, /id: first/)
  assert.match(result, /id: last/)
  assert.doesNotMatch(result, /^\[\]$/m)
  assert.equal(composeProfilePatches(['[]', '# empty']), '[]\n')
  assert.throws(() => composeProfilePatches(['insert: {}']), /must be an array/)
})

test('preserves official executable-expression tags without executing them while composing', () => {
  const expression = 'process.env.DSH_ELECTRON_EXECUTABLE'
  const result = composeProfilePatches(['[]', '- insert:\n    - id: browser\n      disabled: !!js "' + expression + '"\n'])
  assert.match(result, /(?:!!js|!<tag:yaml.org,2002:js>)/)
  assert.match(result, /process\.env\.DSH_ELECTRON_EXECUTABLE/)
  assert.equal(composeProfilePatches([result]), result)
})

test('includes packages loaded from owned patches even when declared as dependencies', () => {
 const result = requiredRuntimeDependencies({dependencies:{'@deepseek-ai/dsh-computer-use':DSH_VERSION},peerDependencies:{'@deepseek-ai/cordis':'4.0.5',optional:'1.0.0'},peerDependenciesMeta:{optional:{optional:true}},devDependencies:{buildOnly:'1.0.0'}})
 assert.equal(result['@deepseek-ai/dsh-computer-use'],DSH_VERSION)
 assert.equal(result['@deepseek-ai/cordis'],'4.0.5')
 assert.equal(result.optional,undefined)
 assert.equal(result.buildOnly,undefined)
})
