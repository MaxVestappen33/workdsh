import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const webRequire = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const runtimeRequire = createRequire(new URL('../../projects/package.json', import.meta.url));
const { build } = webRequire('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/import-associations.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, alias: { 'workdsh-contracts': fileURLToPath(new URL('../../../contracts/src/index.ts', import.meta.url)) }, plugins: [{ name: 'official-runtime', setup(builder) { builder.onResolve({ filter: /^(?:@deepseek-ai\/dsh-storage-domain|zod)$/ }, args => ({ path: pathToFileURL(runtimeRequire.resolve(args.path)).href, external: true })); } }] });
const { openWorkbenchImportAssociations } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const load = async name => import(pathToFileURL(runtimeRequire.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: Storage } = await load('@deepseek-ai/dsh-storage');
const JsonStorage = await load('@deepseek-ai/dsh-storage-json');
const StorageDomain = await load('@deepseek-ai/dsh-storage-domain');
const actor = { principalId: 'member.a', organizationId: 'org', requestId: 'test', resolvedBy: 'trusted-fixture' };

async function boot(root) { const ctx = new Context(); await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root }); await ctx.plugin(StorageDomain, { backend: 'json' }); return ctx; }

const target = { hostId: 'host', installationId: 'desktop', profileId: 'default', harnessVersion: '0.2.0-rc.2' };

test('offline import ownership survives cold restart without inventing requirements or installation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-import-owner-'));let ctx,store;
 try{ctx=await boot(root);store=await openWorkbenchImportAssociations(ctx.storageDomain,actor);
 const input={workbenchId:'company.quality',packageName:'quality-plugin',target};
 const first=await store.bind(input,()=>{});assert.equal(first.requirements,undefined);assert.equal(first.installed,undefined);
 assert.equal((await store.bind(input,()=>{})).id,first.id);
 await assert.rejects(store.bind({...input,packageName:'other-plugin'},()=>{}),/association-conflict/);
 await assert.rejects(store.bind({...input,target:{...target,profileId:'other'}},()=>{}),/association-conflict/);
 await store.close();store=undefined;await ctx.fiber.dispose();ctx=await boot(root);
 store=await openWorkbenchImportAssociations(ctx.storageDomain,actor);assert.equal(store.list()[0].id,first.id);
 const other=await openWorkbenchImportAssociations(ctx.storageDomain,{...actor,principalId:'member.b'});assert.deepEqual(other.list(),[]);await other.close();
 const denied={workbenchId:'company.other',packageName:'other-plugin',target};
 await assert.rejects(store.bind(denied,()=>{throw new Error('revoked');}),/revoked/);assert.equal(store.list().length,1);
 }finally{await store?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
