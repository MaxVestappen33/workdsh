import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(new URL('../../../../apps/web/package.json', import.meta.url))('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/profile-development-source.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'version-fixture', setup(b) { b.onResolve({ filter: /^@deepseek-ai\/dsh-app-boot$/ }, () => ({ path: 'boot', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const getDshRuntimeVersion=()=> '0.2.1-rc.1';" })); } }] });
const { createProfileWorkbenchDevelopmentSourceVerifier: factory } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('Profile source adapter creates real metadata, restores directories and rejects switched identities and redirected roots', async () => {
 const root = await mkdtemp(join(tmpdir(), 'workbench-profile-source-'));
 const actor = { principalId: 'user', organizationId: 'org', resolvedBy: 'fixture' };
 let principal = actor.principalId;
 const profile = { name: 'test', dir: root, home: root };
 const identity = { profile: () => ({ principalId: principal, organization: { id: 'org' }, resolvedBy: 'fixture' }), membership: () => ({ state: 'active' }) };
 let requirement={id:'requirements-1',owner:{organizationId:'org',ownerPrincipalId:'user'},requirements:{title:'检验工作台'}};
 const requirements={history:async()=>[requirement]};
 const ctx = { get: key => key === 'profileContext' ? profile : key==='workdshWorkbenchRequirements'?requirements:identity, fiber: { assertActive() {} } };
 const development = { id: 'dev-1', requirementsRevision:'requirements-1', workbenchId: 'company.quality', packageName: 'quality-plugin', owner: { organizationId: 'org', ownerPrincipalId: 'user' }, target: { hostId: 'host' } };
 try {
  await mkdir(join(root,'node_modules/workdsh-plugin-workbenches'),{recursive:true});
  await writeFile(join(root,'node_modules/workdsh-plugin-workbenches/package.json'),JSON.stringify({name:'workdsh-plugin-workbenches',version:'3.0.0-alpha.99'}));
  const verify = factory(ctx); const source = await verify(actor, development);
  const metadata=JSON.parse(await readFile(join(source.directory,'package.json'),'utf8'));assert.equal(metadata.name,'quality-plugin');assert.equal(metadata.peerDependencies['workdsh-plugin-workbenches'],'^3.0.0-alpha.99');assert.equal(metadata.workdsh.workbench.title,'检验工作台');
  await assert.rejects(verify(actor,{...development,requirementsRevision:'missing'}),/requirements-revision-conflict/);
  const original=requirement;requirement={...requirement,owner:{...requirement.owner,ownerPrincipalId:'other'}};await assert.rejects(verify(actor,development),/requirements-revision-conflict/);requirement=original;
  assert.deepEqual(await verify(actor, { ...development, source }), source);
  const checkpointRoot=join(root,'workdsh-workbench-source-checkpoints',source.directory.split('/').at(-1));
  const oldCheckpoint=join(checkpointRoot,source.revision.slice('source-sha256:'.length));
  const oldSource=await readFile(join(oldCheckpoint,'index.js'),'utf8');
  await writeFile(join(source.directory,'index.js'),'// continued development');
  const changed=await verify(actor,{...development,source});assert.notEqual(changed.revision,source.revision);assert.equal(await readFile(join(oldCheckpoint,'index.js'),'utf8'),oldSource);
  principal = 'other'; await assert.rejects(verify(actor, development), /development-access-denied/); principal = 'user';
  await rm(join(root, 'workdsh-workbench-sources'), { recursive: true });
  await symlink(tmpdir(), join(root, 'workdsh-workbench-sources'));
  await assert.rejects(verify(actor, development), /source-directory-outside/);
 } finally { await rm(root, { recursive: true, force: true }); }
});
