import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const result=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/identity-scope.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createQualityIdentityScopeOwner}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const response=(principalId)=>({ok:true,json:async()=>({ok:true,value:{organizationId:'org',principalId}})});
test('identity owner discards superseded and disposed responses even when fetch ignores abort',async()=>{
 const pending=[],states=[];const owner=createQualityIdentityScopeOwner((url,options)=>new Promise(resolve=>pending.push({resolve,options})),state=>states.push(state));
 const first=owner.check(),second=owner.check();assert.equal(pending[0].options.signal.aborted,true);
 pending[1].resolve(response('new'));await second;pending[0].resolve(response('old'));await first;
 assert.equal(states.at(-1).scope,JSON.stringify(['org','new']));assert.equal(states.filter(s=>!s.checking).length,1);
 const third=owner.check();assert.equal(states.at(-1).scope,JSON.stringify(['org','new']));const count=states.length;owner.dispose();pending[2].resolve(response('other'));await third;assert.equal(states.length,count);
});
test('identity failure clears previous scope and a retry can establish another account',async()=>{
 const states=[];let next=response('first');const owner=createQualityIdentityScopeOwner(async()=>next,state=>states.push(state));
 await owner.check();next=response(' ');await owner.check();assert.deepEqual(states.at(-1),{checking:false,error:true});
 next=response('second');await owner.check();assert.equal(states.at(-1).scope,JSON.stringify(['org','second']));owner.dispose();
});
