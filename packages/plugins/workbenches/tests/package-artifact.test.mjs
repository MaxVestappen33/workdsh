import {preflightExternals} from './support/preflight-externals.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, copyFile, realpath, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const {build:esbuildBuild} = require('esbuild');
const build=options=>esbuildBuild({...options,plugins:[preflightExternals,...(options.plugins??[])]});
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/package-artifact.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) } });
const { inspectWorkbenchPackageArtifact } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const installedBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/installed-artifact.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) } });
const { verifyInstalledWorkbenchArtifact } = await import(`data:text/javascript;base64,${Buffer.from(installedBuilt.outputFiles[0].text).toString('base64')}`);
const verifierBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/installation-verifier.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) } });
const { createWorkbenchInstallationVerifier } = await import(`data:text/javascript;base64,${Buffer.from(verifierBuilt.outputFiles[0].text).toString('base64')}`);
const runtimeRequire = createRequire(new URL('../../projects/package.json', import.meta.url));
const archiveStoreBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/installation-archives.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins:[{name:'official-storage',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtimeRequire.resolve(args.path)).href,external:true}));}}] });
const registrationHostBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/registration-host.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins:[{name:'official-storage',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtimeRequire.resolve(args.path)).href,external:true}));}}] });
const { mountWorkbenchRegistrationHost } = await import(`data:text/javascript;base64,${Buffer.from(registrationHostBuilt.outputFiles[0].text).toString('base64')}`);
const { WorkbenchInstallationArchives } = await import(`data:text/javascript;base64,${Buffer.from(archiveStoreBuilt.outputFiles[0].text).toString('base64')}`);
const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');
const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const JsonStorage=await load('@deepseek-ai/dsh-storage-json'), StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
async function storageBoot(root){const ctx=new Context();await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(StorageDomain,{backend:'json'});return ctx;}
const layoutBuilt = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/package-layout.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { validateWorkbenchPackageLayout } = await import(`data:text/javascript;base64,${Buffer.from(layoutBuilt.outputFiles[0].text).toString('base64')}`);
const descriptor = { id: 'company.quality', title: '质量分析', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.0-rc.2' }, capabilities: [] };
const manifest = { name: 'quality-fixture', version: '0.1.0', type: 'module', workdsh: { workbench: descriptor }, files: ['index.js', 'index.d.ts', 'client.js', 'client.d.ts', 'cordis.patch.yml'], exports: { '.': { types: './index.d.ts', default: './index.js' }, './client': { types: './client.d.ts', default: './client.js' } }, peerDependencies: { '@deepseek-ai/cordis': '4.0.4', '@deepseek-ai/dsh-client-ui-slots': '0.2.0-rc.2' }, dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } };
const expected = { packageName: manifest.name, version: manifest.version, workbenchId: descriptor.id };
function archive(entries) {
  const chunks = [];
  for (const { name, data = '', type = '0' } of entries) {
    const bytes = Buffer.from(data), header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write(type, 156);
    header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}
test('inspect actual pnpm archive derives receipt hash and identity without executing package entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-package-artifact-'));
  try {
    const source = join(root, 'source'), output = join(root, 'packed');
    await mkdir(source); await mkdir(output);
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(source, 'index.js'), 'throw new Error("must never execute archive code");');
    for (const name of ['index.d.ts', 'client.js', 'client.d.ts', 'cordis.patch.yml']) await writeFile(join(source, name), 'layout fixture only');
    const pnpm = fileURLToPath(new URL('../../../../apps/web/node_modules/pnpm/bin/pnpm.cjs', import.meta.url));
    await promisify(execFile)(process.execPath, [pnpm, '--dir', source, 'pack', '--pack-destination', output], { cwd: source });
    const path = join(output, 'quality-fixture-0.1.0.tgz');
    const bytes = await readFile(path), hash = createHash('sha256').update(bytes).digest('hex');
    const result = await inspectWorkbenchPackageArtifact(path, { ...expected, sha256: hash });
    assert.equal(result.receipt.sha256, hash);
    assert.equal(result.fileDigests['index.js'].sha256,createHash('sha256').update(await readFile(join(source,'index.js'))).digest('hex'));
    const installation=join(root,'installation'), installed=join(installation,'node_modules',manifest.name);
    await mkdir(installation);await writeFile(join(installation,'package.json'),JSON.stringify({private:true}));
    await promisify(execFile)(process.execPath,[pnpm,'--dir',installation,'add',path,'--ignore-scripts','--offline','--config.auto-install-peers=false','--package-import-method=copy','--store-dir',join(root,'store')],{cwd:installation});
    assert.equal((await verifyInstalledWorkbenchArtifact(installation,path,{...expected,sha256:hash})).receipt.sha256,hash);
    const verify = createWorkbenchInstallationVerifier(installation,async(name,version)=>{assert.equal(name,expected.packageName);assert.equal(version,expected.version);return {path,sha256:hash,workbenchId:descriptor.id};},value=>value.id===descriptor.id);
    const verified=await verify(expected.packageName,expected.version);
    assert.equal(verified.package.sha256,hash);assert.deepEqual(verified.descriptor,descriptor);assert.equal(verified.compatible,true);
    let storageContext,archives;
    try {
      storageContext=await storageBoot(join(root,'storage'));
      archives=await WorkbenchInstallationArchives.open(storageContext.storageDomain,'installation-fixture',installation);
      const transient=join(root,'transient.tgz');await copyFile(path,transient);
      const record={...expected,path:transient,sha256:hash};
      await assert.rejects(archives.retainVerified(record,()=>{throw new Error('denied');}),/denied/);
      assert.throws(()=>archives.resolve(expected.packageName,expected.version),/archive-unavailable/);
      await archives.retainVerified(record,()=>{});await archives.retainVerified(record,()=>{});
      await rm(transient);
      await archives.close();await storageContext.fiber.dispose();
      storageContext=await storageBoot(join(root,'storage'));
      archives=await WorkbenchInstallationArchives.open(storageContext.storageDomain,'installation-fixture',installation);
      assert.deepEqual(archives.resolve(expected.packageName,expected.version),{path:join(await realpath(installation),'.workdsh-workbench-archives',hash+'.tgz'),sha256:hash,workbenchId:descriptor.id});
      await archives.close();
      await assert.rejects(WorkbenchInstallationArchives.open(storageContext.storageDomain,'installation-fixture',root),/target-mismatch/);
      archives=await WorkbenchInstallationArchives.open(storageContext.storageDomain,'installation-fixture',installation);
      const restoredVerify=createWorkbenchInstallationVerifier(installation,async(name,version)=>archives.resolve(name,version),()=>true);
      assert.equal((await restoredVerify(expected.packageName,expected.version)).package.sha256,hash);
      const officialRequire=createRequire(require.resolve('@deepseek-ai/dsh/package.json'));
      const {default:Loader}=await import(pathToFileURL(officialRequire.resolve('@deepseek-ai/cordis-plugin-loader')).href);
      await storageContext.plugin(Loader,{baseUrl:pathToFileURL(installation+'/').href});
      // Explicit launcher facts fixture; this does not claim CLI Profile acceptance.
      storageContext.provide('profileContext',{name:'isolated',dir:installation});
      let mounted;
      await storageContext.plugin({name:'platform-mount-fixture',inject:['profileContext','storageDomain','loader'],async apply(ctx){mounted=await mountWorkbenchRegistrationHost(ctx,()=>true);}});
      assert.equal(mounted.directory,await realpath(installation));assert.equal(mounted.installationId.length,64);
      assert.deepEqual(mounted.registration.list(),[]);
      const retained=archives.resolve(expected.packageName,expected.version).path;
      await chmod(retained,0o600);await writeFile(retained,'corrupted existing archive');
      await assert.rejects(archives.retainVerified({...record,path},()=>{}),/package-hash-mismatch/);
      assert.equal(await readFile(retained,'utf8'),'corrupted existing archive','content-addressed archives are not overwritten silently');
      await assert.rejects(restoredVerify(expected.packageName,expected.version),/package-hash-mismatch/);
    } finally {await archives?.close();await storageContext?.fiber.dispose();}
    await writeFile(join(installed,'index.js'),'modified code');
    await assert.rejects(verify(expected.packageName,expected.version),/installed-file-mismatch/);
    await assert.rejects(verifyInstalledWorkbenchArtifact(installation,path,{...expected,sha256:hash}),/installed-file-mismatch/);
    await rm(join(installed,'index.js'));await symlink(join(source,'index.js'),join(installed,'index.js'));
    await assert.rejects(verifyInstalledWorkbenchArtifact(installation,path,{...expected,sha256:hash}),/installed-file-outside-package/);
    assert.equal(result.manifest.descriptor.id, descriptor.id);
    assert.ok(result.files.includes('index.js'));
    assert.ok(result.files.includes('package.json'));
    assert.equal(result.archiveBytes, bytes.length);
    assert.equal(Object.isFrozen(result.packageMetadata.exports['.']), true);
    const layout = validateWorkbenchPackageLayout(result, { harnessVersion: '0.2.0-rc.2', cordisVersion: '4.0.4' });
    assert.equal(layout.host, 'index.js');
    assert.equal(layout.client, 'client.js');
    assert.equal(layout.patch, 'cordis.patch.yml');
    assert.throws(() => validateWorkbenchPackageLayout({ ...result, files: result.files.filter(name => name !== 'client.js') }, { harnessVersion: '0.2.0-rc.2', cordisVersion: '4.0.4' }), /package-missing-export/);
    assert.throws(() => validateWorkbenchPackageLayout(result, { harnessVersion: '0.2.1-rc.1', cordisVersion: '4.0.4' }), /package-kernel-version-mismatch/);
    assert.throws(() => validateWorkbenchPackageLayout(result, { harnessVersion: '0.2.0-rc.2', cordisVersion: '4.0.5' }), /package-cordis-version-mismatch/);
    assert.throws(() => validateWorkbenchPackageLayout({ ...result, packageMetadata: { ...result.packageMetadata, dependencies: { 'private-sdk': 'workspace:*' } } }, { harnessVersion: '0.2.0-rc.2', cordisVersion: '4.0.4' }), /package-unresolved-workspace-dependency/);
    const altered = { ...result, packageMetadata: { ...result.packageMetadata, exports: { ...result.packageMetadata.exports, './escape': '../outside.js' } } };
    assert.throws(() => validateWorkbenchPackageLayout(altered, { harnessVersion: '0.2.0-rc.2', cordisVersion: '4.0.4' }), /package-invalid-export/);
    await assert.rejects(inspectWorkbenchPackageArtifact(path, { ...expected, sha256: 'a'.repeat(64) }), /package-hash-mismatch/);
    await assert.rejects(inspectWorkbenchPackageArtifact(path, { ...expected, workbenchId: 'company.other' }), /package-identity-mismatch/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(inspectWorkbenchPackageArtifact(path, expected, aborted.signal), { name: 'AbortError' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('archive metadata inspection rejects traversal, duplicates and links rather than extracting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-package-invalid-'));
  try {
    const path = join(root, 'bad.tgz'), metadata = { name: 'package/package.json', data: JSON.stringify(manifest) };
    for (const [extra, code] of [[{ name: 'package/../outside', data: 'escape' }, 'package-invalid-path'],
      [{ name: '._package', data: 'macOS metadata' }, 'package-macos-metadata'], [{ ...metadata }, 'package-duplicate-path'], [{ name: 'package/link', type: '2' }, 'package-unsupported-entry']]) {
      await writeFile(path, archive([metadata, extra]));
      await assert.rejects(inspectWorkbenchPackageArtifact(path, expected), new RegExp(code));
    }
    await writeFile(path, Buffer.from('not gzip'));
    await assert.rejects(inspectWorkbenchPackageArtifact(path, expected), /invalid-package-archive/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('compressed and expanded byte budgets reject oversized inputs without accepting partial metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-package-budgets-'));
  try {
    const path = join(root, 'oversized.tgz');
    await writeFile(path, Buffer.alloc(8 * 1024 * 1024 + 1));
    await assert.rejects(inspectWorkbenchPackageArtifact(path, expected), /package-archive-size-limit/);
    await writeFile(path, gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1)));
    await assert.rejects(inspectWorkbenchPackageArtifact(path, expected), /package-expanded-size-limit/);
    await writeFile(path, archive([{ name: 'package/package.json', data: ' '.repeat(256 * 1024 + 1) }]));
    await assert.rejects(inspectWorkbenchPackageArtifact(path, expected), /manifest-size-limit/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual archive tool errors are blocked by the common package gate before any entry executes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-tool-gate-'));
 try{
  const entries=Object.keys({'index.js':1,'index.d.ts':1,'client.js':1,'client.d.ts':1,'cordis.patch.yml':1}).map(name=>({name:'package/'+name,data:name==='index.js'?"import {defineTool} from '@deepseek-ai/dsh-tools';throw Error('must not execute');function mount(){defineTool({parameters:{weekKey:{type:'string',required:false}}})}":''}));
  const path=join(root,'candidate.tgz');await writeFile(path,archive([{name:'package/package.json',data:JSON.stringify(manifest)},...entries]));
  const inspected=await inspectWorkbenchPackageArtifact(path,expected);
  assert.throws(()=>validateWorkbenchPackageLayout(inspected,{harnessVersion:'0.2.0-rc.2',cordisVersion:'4.0.4'}),/tool-optional-required-false/);
 }finally{await rm(root,{recursive:true,force:true});}
});
