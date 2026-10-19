import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await web('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/activation-message.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const{activationMessage:message}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('observed startup failure takes precedence over a successful setting acknowledgement or suggested restart',()=>{
 for(const result of [undefined,{confirmed:true,pendingRestart:false},{confirmed:false,pendingRestart:true}])assert.match(message('进度应用',true,{selected:true,runtimeStatus:'failed'},result),/已启用，但应用启动失败/);
});
test('success requires actual active registration; unknown outcome does not claim a running application',()=>{
 assert.match(message('应用',true,{selected:true,runtimeStatus:'active',registered:true}),/可以打开试用/);
 assert.doesNotMatch(message('应用',true,{selected:true,runtimeStatus:'unknown'},{confirmed:true,pendingRestart:false}),/可以打开/);
 assert.match(message('应用',false,{selected:false},{confirmed:true,pendingRestart:false}),/已停用/);
});
