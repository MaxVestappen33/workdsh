import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,writeFile,symlink,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/development-starter.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {createWorkbenchStarter}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('generated starter builds actual Host and Client artifacts with stable package identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workdsh-starter-'));
 try{
 const descriptor={id:'probe.starter',title:'骨架验证',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
 const starter=createWorkbenchStarter('workdsh-probe-starter',descriptor);assert.match(starter.files['.npmrc'],/legacy-peer-deps=true/);assert.match(starter.files['.npmrc'],/cache=\.workdsh-npm-cache/);assert.match(starter.manifest.peerDependencies['workdsh-plugin-workbenches'],/^\^3\.0\.0-alpha\./);await writeFile(join(dir,'package.json'),JSON.stringify(starter.manifest));for(const [name,content] of Object.entries(starter.files))await writeFile(join(dir,name),content);
 await symlink(fileURLToPath(new URL('../../../../apps/web/node_modules',import.meta.url)),join(dir,'node_modules'),'dir');
 const result=spawnSync(process.execPath,['build.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 // Public SDK imports must stay external, even with no locally resolvable SDK.
 await writeFile(join(dir,'client.jsx'),"import {WorkbenchButton} from 'workdsh-plugin-workbenches/client';\n"+starter.files['client.jsx'].replace('插件骨架已加载。','插件骨架已加载。').replace('<main>','<main><WorkbenchButton>保存</WorkbenchButton>'));
 const sdkBuild=spawnSync(process.execPath,['build.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(sdkBuild.status,0,sdkBuild.stderr);
 assert.match(await readFile(join(dir,'dist/client.browser.js'),'utf8'),/require\("workdsh-plugin-workbenches\/client"\)/);
 // A metadata edit must reach both built registrations without editing two source copies.
 starter.manifest.workdsh.workbench.description='Updated shared declaration';
 await writeFile(join(dir,'package.json'),JSON.stringify(starter.manifest));
 const rebuilt=spawnSync(process.execPath,['build.mjs'],{cwd:dir,encoding:'utf8'});assert.equal(rebuilt.status,0,rebuilt.stderr);
 const registered=await import(new URL('file://'+join(dir,'dist/index.js')));
 assert.equal(registered.descriptor.description,'Updated shared declaration');
 assert.match(await readFile(join(dir,'dist/client.browser.js'),'utf8'),/Updated shared declaration/);
 const host=await readFile(join(dir,'dist/index.js'),'utf8'),client=await readFile(join(dir,'dist/client.browser.js'),'utf8');assert.match(host,/registerManaged/);assert.match(client,/id:"workdsh-probe-starter"/);assert.match(client,/aria-label/);assert.equal(starter.manifest.workdsh.workbench.id,descriptor.id);for(const entry of ['.','./client']){const types=starter.manifest.exports[entry].types;assert.match(await readFile(join(dir,types),'utf8'),/apply\(ctx:Context\)/);}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('confirmed system modules produce navigation without changing declaration identity',()=>{
 const descriptor={id:'probe.modules',title:'质量分析',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
 const system={schemaVersion:'1',modules:[{id:'inspection',title:'检验分析',pages:[],dependsOn:[]},{id:'report',title:'报告中心',pages:[],dependsOn:['inspection']}]};
 const starter=createWorkbenchStarter('workdsh-probe-modules',descriptor,system);
 assert.ok(starter.files['client.jsx'].includes(JSON.stringify([['inspection','检验分析'],['report','报告中心']])));
 assert.equal(starter.manifest.workdsh.workbench.id,'probe.modules');
});
