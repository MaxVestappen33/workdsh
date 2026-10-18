import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/shortcuts.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchShortcuts,switcherSections}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const mount=id=>({descriptor:{id,title:id,description:'业务应用'},panelKey:`workdsh-workbench:${id}`,signal:new AbortController().signal});
test('switcher lists verified page lifetimes, filters unavailable preferences and retains stable application identity',async()=>{
 let ids=['app.a','app.uninstalled'];
 const controller=createWorkbenchShortcuts(async(_path,request)=>{const input=JSON.parse(request.body);if(input.id)ids=input.pinned?[...ids,input.id]:ids.filter(id=>id!==input.id);return Response.json({ok:true,value:{organizationId:'org',principalId:'user',ids}});});
 const releaseA=controller.track(mount('app.a')),releaseB=controller.track(mount('app.b'));
 await controller.refresh();let sections=switcherSections(controller.getSnapshot(),'');assert.deepEqual(sections.common.map(a=>a.id),['app.a']);assert.deepEqual(sections.other.map(a=>a.id),['app.b']);
 controller.setActive('app.b');controller.show();assert.equal(controller.getSnapshot().activeId,'app.b');assert.equal(controller.getSnapshot().open,true);
 await controller.setPinned('app.b',true);assert.equal(switcherSections(controller.getSnapshot(),'').common.length,2);
 releaseA();assert.deepEqual(controller.getSnapshot().apps.map(a=>a.id),['app.b']);
 await controller.setPinned('app.b',false);assert.equal(switcherSections(controller.getSnapshot(),'').common.length,0);releaseB();controller.close();assert.equal(controller.getSnapshot().apps.length,0);assert.equal(controller.getSnapshot().open,false);
});
test('search covers common and other applications without duplicating rows; aborted pages disappear',async()=>{
 const controller=createWorkbenchShortcuts(async()=>Response.json({ok:true,value:{organizationId:'org',principalId:'user',ids:['app.a']}}));
 const lifetime=new AbortController(),page={...mount('app.a'),signal:lifetime.signal};controller.track(page);controller.track(mount('app.b'));await controller.refresh();
 assert.deepEqual(switcherSections(controller.getSnapshot(),'APP.A').common.map(a=>a.id),['app.a']);assert.equal(switcherSections(controller.getSnapshot(),'missing').other.length,0);
 lifetime.abort();assert.equal(controller.getSnapshot().apps.length,1);assert.equal(switcherSections(controller.getSnapshot(),'').common.length,0);controller.close();
});
test('failed identity/preference refresh drops previous account preferences',async()=>{
 let fail=false;const controller=createWorkbenchShortcuts(async()=>fail?Response.json({ok:false},{status:403}):Response.json({ok:true,value:{organizationId:'org',principalId:'user',ids:['app.a']}}));
 controller.track(mount('app.a'));await controller.refresh();assert.equal(controller.getSnapshot().ids.length,1);
 fail=true;await controller.refresh();assert.equal(controller.getSnapshot().ids.length,0);assert.equal(controller.getSnapshot().ready,false);assert.match(controller.getSnapshot().error,/无法读取/);controller.close();
});
test('invalid preference response and completion after disposal cannot restore entries',async()=>{
 let resolve;const controller=createWorkbenchShortcuts(()=>new Promise(r=>resolve=r));controller.track(mount('app.a'));
 const pending=controller.refresh();controller.close();resolve(Response.json({ok:true,value:{organizationId:'org',principalId:'user',ids:['app.a']}}));await pending;assert.equal(controller.getSnapshot().apps.length,0);
 const invalid=createWorkbenchShortcuts(async()=>Response.json({ok:true,value:{organizationId:'org',principalId:'user',ids:['app.a','app.a']}}));await invalid.refresh();assert.equal(invalid.getSnapshot().ready,false);invalid.close();
});
