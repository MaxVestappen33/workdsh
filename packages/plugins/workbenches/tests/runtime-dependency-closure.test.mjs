import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire, isBuiltin} from 'node:module';
import {mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const sdkDirectory = fileURLToPath(new URL('..', import.meta.url));
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const sdk = JSON.parse(await readFile(join(sdkDirectory, 'package.json'), 'utf8'));
const sdkRequire = createRequire(join(sdkDirectory, 'package.json'));
const webRequire = createRequire(join(repository, 'apps/web/package.json'));
const officialRequire = createRequire(await realpath(webRequire.resolve('@deepseek-ai/dsh/package.json')));
const ts = webRequire('typescript');
const {build} = webRequire('esbuild');
const required = {...sdk.dependencies, ...Object.fromEntries(Object.entries(sdk.peerDependencies ?? {})
  .filter(([name]) => sdk.peerDependenciesMeta?.[name]?.optional !== true))};
const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

// Parse actual runtime sources so another fixed dynamic dependency cannot hide
// behind the larger development tree or a devDependency-only declaration.
async function fixedRuntimeSpecifiers(directory, collected = new Set()) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await fixedRuntimeSpecifiers(path, collected); continue; }
    if (!/\.(?:tsx?|mjs)$/.test(entry.name)) continue;
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
        const callee = node.expression;
        const resolves = ts.isPropertyAccessExpression(callee) && callee.name.text === 'resolve';
        const requires = ts.isIdentifier(callee) && callee.text === 'require';
        const createdRequire = ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'createRequire';
        if (resolves || requires || createdRequire) {
          const specifier = node.arguments[0].text;
          if (!isBuiltin(specifier) && !specifier.startsWith('.') && !isAbsolute(specifier)) collected.add(specifier);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return collected;
}

const fixed = await fixedRuntimeSpecifiers(join(sdkDirectory, 'src'));
await fixedRuntimeSpecifiers(join(sdkDirectory, 'scripts'), fixed);
const installerOutput = await build({entryPoints: [join(sdkDirectory, 'src/runtime/profile-installer.ts')], bundle: true, platform: 'node', format: 'esm', write: false});
const {createProfileWorkbenchInstaller} = await import(`data:text/javascript;base64,${Buffer.from(installerOutput.outputFiles[0].text).toString('base64')}`);

async function isolatedProfile(directory, omitted = []) {
  await mkdir(directory, {recursive: true});
  const anchor = join(directory, 'package.json');
  await writeFile(anchor, JSON.stringify({private: true, dependencies: required}));
  // Only the declared production closure is visible at this root. The physical
  // packages are real published packages; their own transitive dependencies are
  // preserved, but cannot make an undeclared name resolvable from this anchor.
  for (const name of [sdk.name, ...Object.keys(required)].filter(name => !omitted.includes(name))) {
    let target = sdkDirectory;
    if (name !== sdk.name) {
      let manifest;
      try { manifest = sdkRequire.resolve(`${name}/package.json`); }
      catch { manifest = officialRequire.resolve(`${name}/package.json`); }
      target = dirname(await realpath(manifest));
      const installed = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
      assert.equal(installed.version, required[name], `fixture must use the exact declared ${name}`);
    }
    const link = join(directory, 'node_modules', name);
    await mkdir(dirname(link), {recursive: true});
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
  return {name: 'closure-test', dir: directory, home: directory, cwd: directory, installAnchor: anchor};
}

test('fixed runtime lookups are mandatory production dependencies, including public subpaths', () => {
  assert.ok(fixed.has('@deepseek-ai/dsh-atomic-write'));
  assert.ok(fixed.has('@deepseek-ai/dsh-plugin-manager/operations'));
  for (const specifier of fixed) {
    const name = packageName(specifier);
    if (name !== sdk.name) assert.ok(Object.hasOwn(required, name), `undeclared production lookup: ${specifier}`);
  }
});

test('installer loads real public APIs from an isolated declared Profile root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workdsh-profile-closure-'));
  try {
    const profile = await isolatedProfile(directory);
    const require = createRequire(profile.installAnchor);
    for (const specifier of fixed) assert.ok(require.resolve(specifier), `unresolvable Profile lookup: ${specifier}`);
    const installer = await createProfileWorkbenchInstaller({get: name => name === 'profileContext' ? profile : undefined}, () => assert.fail('loading must not authorize an installation'));
    assert.equal(typeof installer, 'function');
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('Profile closure check detects each missing dynamically loaded installer package', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'workdsh-profile-missing-'));
  try {
    for (const name of ['@deepseek-ai/dsh-atomic-write', '@deepseek-ai/dsh-plugin-manager']) {
      const profile = await isolatedProfile(join(directory, name.split('/').at(-1)), [name]);
      await assert.rejects(createProfileWorkbenchInstaller({get: () => profile}, () => {}), error =>
        error.code === 'MODULE_NOT_FOUND' && error.message.includes(name));
    }
  } finally { await rm(directory, {recursive: true, force: true}); }
});
