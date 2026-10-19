import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const result = await build({entryPoints:[fileURLToPath(new URL('../src/client/activation-association.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {resolveActivationAssociation:resolve} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('late development lookup cannot proceed to imports or activation after cancellation', async()=>{
 const controller=new AbortController(); let imports=0, mutations=0, release;
 const pending=resolve('quality','quality',()=>new Promise(done=>{release=done}),async()=>{imports++;return []},controller.signal).then(()=>{controller.signal.throwIfAborted();mutations++});
 controller.abort();release([]);
 await assert.rejects(pending,{name:'AbortError'});assert.equal(imports,0);assert.equal(mutations,0);
});
test('late offline lookup is cancelled even when its transport ignores abort', async()=>{
 const controller=new AbortController();let release,mutations=0;
 const pending=resolve('quality','quality',async()=>[],()=>new Promise(done=>{release=done}),controller.signal).then(()=>{mutations++});
 await Promise.resolve();controller.abort();release([{importId:'import-id',packageName:'quality',workbenchId:'quality'}]);
 await assert.rejects(pending,{name:'AbortError'});assert.equal(mutations,0);
});
test('association requires both identities and prefers the existing development',async()=>{
 const controller=new AbortController();let imports=0;
 const value=await resolve('quality','quality',async()=>[{development:{id:'wrong',packageName:'quality',workbenchId:'other'}},{development:{id:'existing',packageName:'quality',workbenchId:'quality'}}],async()=>{imports++;return []},controller.signal);
 assert.equal(value,'existing');assert.equal(imports,0);
});
