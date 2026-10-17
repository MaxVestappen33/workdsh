import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/host-registration.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/workbenches.ts', import.meta.url)) } });
const { HostWorkbenchRegistration } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const descriptor = { id: 'company.quality', title: '质量', description: '', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.1-rc.1' }, capabilities: [] };
const receipt = { packageName: 'quality', version: '1.0.0', sha256: 'a'.repeat(64) };
function fixture(verify) {
  const entry = { options: { name: 'quality' }, disabled: false };
  const caller = { fiber: { assertActive() {} } };
  const loader = { locate(fiber) { return fiber === caller.fiber ? 'quality-entry' : undefined; }, resolve() { return entry; } };
  const reader = { async read() { return { packageName: 'quality', version: '1.0.0', descriptor }; } };
  return { entry, caller, service: new HostWorkbenchRegistration(loader, reader, verify) };
}
test('host registration joins source, manifest and verified installation receipt', async () => {
  const { caller, service } = fixture(async () => ({ package: receipt, compatible: true, descriptor }));
  const dispose = await service.register(caller, descriptor, 'quality-page');
  assert.equal(service.list()[0].package.sha256, receipt.sha256);
  dispose();
  assert.deepEqual(service.list(), []);
});
test('disablement during installation verification prevents late registration', async () => {
  let release;
  const { caller, service, entry } = fixture(() => new Promise(resolve => { release = resolve; }));
  const pending = service.register(caller, descriptor, 'quality-page');
  await new Promise(resolve => setImmediate(resolve));
  entry.disabled = true;
  release({ package: receipt, compatible: true, descriptor });
  await assert.rejects(pending, /package-disabled/);
  assert.deepEqual(service.list(), []);
});
test('receipt identity mismatch cannot activate a workbench', async () => {
  const { caller, service } = fixture(async () => ({ package: { ...receipt, version: '2.0.0' }, compatible: true, descriptor }));
  await assert.rejects(service.register(caller, descriptor, 'page'), /installation-changed/);
  assert.deepEqual(service.list(), []);
});

test('same-version manifest changes cannot activate an old declaration', async () => {
 const {caller,service}=fixture(async()=>({package:receipt,compatible:true,descriptor:{...descriptor,title:'Changed'}}));
 await assert.rejects(service.register(caller,descriptor,'page'),/installation-declaration-changed/);
 assert.deepEqual(service.list(),[]);
});

test('Host shutdown rejects pending registration and held service calls',async()=>{
 let release;
 const {caller,service}=fixture(()=>new Promise(resolve=>{release=resolve;}));
 const pending=service.register(caller,descriptor,'page');
 await new Promise(resolve=>setImmediate(resolve));service.close();
 release({package:receipt,compatible:true,descriptor});
 await assert.rejects(pending,/registration-service-closed/);
 assert.throws(()=>service.list(),/registration-service-closed/);
 await assert.rejects(service.register(caller,descriptor,'page'),/registration-service-closed/);
 service.close();
});

test('Client authority rechecks loaded Host caller and exact retained installation', async () => {
 let installed = { package: receipt, compatible: true, descriptor };
 const { caller, service, entry } = fixture(async () => installed);
 await assert.rejects(service.clientAuthority('quality'), /unregistered-package/);
 const release = await service.register(caller, descriptor, 'page');
 assert.equal((await service.clientAuthority('quality')).package.sha256, receipt.sha256);
 entry.disabled = true; await assert.rejects(service.clientAuthority('quality'), /package-disabled/); entry.disabled = false;
 installed = { ...installed, package: { ...receipt, sha256: 'b'.repeat(64) } };
 await assert.rejects(service.clientAuthority('quality'), /installation-changed/);
 release(); await assert.rejects(service.clientAuthority('quality'), /unregistered-package/);
});
