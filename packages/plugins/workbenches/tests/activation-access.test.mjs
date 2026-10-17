import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/runtime/activation-access.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchActivationAccess}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const actor={principalId:'member',organizationId:'enterprise',resolvedBy:'trusted-provider'};
function fixture(role){let member={role,state:'active'};let profile={principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};return {identity:{profile:()=>profile,membership:()=>member},role:value=>member={...member,role:value},suspend:()=>member={...member,state:'suspended'},switch:()=>profile={...profile,principalId:'other'}};}
test('enterprise administrator may manage without development but role revocation stops execution',()=>{
 const f=fixture('admin'),access=createWorkbenchActivationAccess(f.identity,actor,()=>{});
 assert.equal(access.profileManager,true);access.authorize();f.role('member');assert.throws(access.authorize,/development-access-denied/);
});
test('ordinary member needs trusted association; suspension and account switch reject late execution',()=>{
 const f=fixture('member'),access=createWorkbenchActivationAccess(f.identity,actor,()=>{});
 assert.equal(access.profileManager,false);assert.throws(access.authorize,/development-access-denied/);
 access.confirmDevelopmentAssociation();access.authorize();f.suspend();assert.throws(access.authorize,/development-access-denied/);
 const other=fixture('owner'),owner=createWorkbenchActivationAccess(other.identity,actor,()=>{});other.switch();assert.throws(owner.authorize,/development-access-denied/);
});
