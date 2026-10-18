import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {mkdtemp,mkdir,cp,writeFile,symlink,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {spawnSync} from 'node:child_process';import{gunzipSync}from'node:zlib';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/development-starter.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {createWorkbenchStarter}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('generated starter builds actual Host and Client artifacts with stable package identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'workdsh-starter-'));
 try{
 const descriptor={id:'probe.starter',title:'骨架验证',description:'',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
 const starter=createWorkbenchStarter('workdsh-probe-starter',descriptor);assert.match(starter.files['.npmrc'],/auto-install-peers=false/);assert.match(starter.files['.npmrc'],/store-dir=\.workdsh-pnpm-store/);assert.match(starter.manifest.peerDependencies['workdsh-plugin-workbenches'],/^\^3\.0\.0-alpha\./);await writeFile(join(dir,'package.json'),JSON.stringify(starter.manifest));for(const [name,content] of Object.entries(starter.files))await writeFile(join(dir,name),content);
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

test('the same Desktop starter builds, checks and delivers with an installation anchor and no Profile SDK tree',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-desktop-starter-'));let report;
 try{
  const profile=join(root,'home/profiles/workdsh'),source=join(profile,'workdsh-workbench-sources/probe'),installation=join(root,'installation'),sdk=join(installation,'node_modules/workdsh-plugin-workbenches');
  await mkdir(source,{recursive:true});await mkdir(sdk,{recursive:true});
  const original=fileURLToPath(new URL('..',import.meta.url)),sdkRequire=createRequire(join(original,'package.json'));
  for(const file of ['package.json','dist','scripts'])await cp(join(original,file),join(sdk,file),{recursive:true});
  await writeFile(join(installation,'package.json'),'{}');
  for(const name of ['@deepseek-ai/cordis','semver']){
   const target=dirname(sdkRequire.resolve(name+'/package.json')),link=join(installation,'node_modules',name);await mkdir(dirname(link),{recursive:true});await symlink(target,link,process.platform==='win32'?'junction':'dir');
  }
  const primary=join(root,'primary'),pnpm=fileURLToPath(new URL('../../../../apps/web/node_modules/pnpm',import.meta.url));
  await mkdir(join(primary,'dependencies'),{recursive:true});await symlink(pnpm,join(primary,'dependencies/pnpm'),process.platform==='win32'?'junction':'dir');
  await writeFile(join(primary,'runtime.json'),JSON.stringify({pnpm:JSON.parse(await readFile(join(pnpm,'package.json'),'utf8')).version}));
  const descriptor={id:'probe.desktop-starter',title:'Desktop骨架验证',protocolVersion:'1.0',layout:'full-page',hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
  const starter=createWorkbenchStarter('workdsh-probe-desktop-starter',descriptor);await writeFile(join(source,'package.json'),JSON.stringify(starter.manifest));
  for(const [name,content]of Object.entries(starter.files))await writeFile(join(source,name),content);
  await writeFile(join(source,'.workdsh-runtime.json'),JSON.stringify({schemaVersion:1,installationAnchor:join(installation,'package.json')}));
  await mkdir(join(source,'node_modules'));await symlink(dirname(require.resolve('esbuild/package.json')),join(source,'node_modules/esbuild'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createRequire(join(source,'package.json')).resolve('workdsh-plugin-workbenches'));
  assert.match(starter.files['.gitignore'],/\.workdsh-runtime\.json/);
  const build=spawnSync(process.execPath,['build.mjs'],{cwd:source,encoding:'utf8',timeout:15000});assert.equal(build.status,0,build.stderr);
  const check=spawnSync(process.execPath,[join(source,'check-startup.mjs')],{cwd:profile,encoding:'utf8',timeout:15000});assert.equal(check.status,0,check.stderr+check.stdout);assert.equal(JSON.parse(check.stdout).status,'passed');
  const delivery=spawnSync(process.execPath,[join(source,'deliver.mjs')],{cwd:profile,encoding:'utf8',timeout:15000,env:{...process.env,DSH_BUNDLED_PRIMARY_RUNTIME:primary}});
  assert.equal(delivery.status,0,delivery.stderr+delivery.stdout);report=JSON.parse(delivery.stdout);assert.equal(report.status,'passed');assert.deepEqual(report.stages.map(stage=>stage.name),['build','startup-check','pack']);
  const tar=gunzipSync(await readFile(join(source,report.candidate.filename))).toString('utf8');assert.equal(tar.includes('package/.workdsh-runtime.json\0'),false);assert.equal(tar.includes(installation),false);
  await assert.rejects(readFile(join(profile,'node_modules/package.json')),error=>error.code==='ENOENT');
 }finally{await rm(root,{recursive:true,force:true});if(report)await rm(dirname(report.reportPath),{recursive:true,force:true});}
});
