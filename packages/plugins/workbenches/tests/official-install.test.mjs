import {preflightExternals} from './support/preflight-externals.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
const rootPath=fileURLToPath(new URL('../../../../',import.meta.url));
const anchor=realpathSync(join(rootPath,'apps/web/node_modules/@deepseek-ai/dsh/package.json'));
const officialRequire=createRequire(anchor);
const {runPluginCommand}=await import(pathToFileURL(officialRequire.resolve('@deepseek-ai/dsh-plugin-manager/operations')).href);
const pnpm=join(rootPath,'apps/web/node_modules/pnpm/bin/pnpm.cjs');
const {build:esbuildBuild} =createRequire(join(rootPath,'apps/web/package.json'))('esbuild');
const build=options=>esbuildBuild({...options,plugins:[preflightExternals,...(options.plugins??[])]});
async function loadOwned(relative) {
 const built=await build({entryPoints:[join(rootPath,'packages/plugins/workbenches/src/runtime',relative)],bundle:true,platform:'node',format:'esm',write:false,
  alias:{'workdsh-contracts':join(rootPath,'packages/contracts/src/index.ts')},
  plugins:[{name:'published-storage',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|@deepseek-ai\/dsh-app-boot|zod)$/},args=>({path:pathToFileURL(officialRequire.resolve(args.path)).href,external:true}));}}]});
 return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
}
const {inspectWorkbenchPackageArtifact}=await loadOwned('package-artifact.ts');
const {verifyInstalledWorkbenchArtifact}=await loadOwned('installed-artifact.ts');
const {importWorkbenchArchive}=await loadOwned('import-owner.ts');
const {createProfileWorkbenchInstaller}=await loadOwned('profile-installer.ts');
const {createWorkbenchImportOperationAdapter}=await loadOwned('import-operation.ts');
const {WorkbenchDevelopmentOperations}=await loadOwned('development-operations.ts');
const {setWorkbenchBundleEnabled}=await loadOwned('activation-owner.ts');
const {prepareWorkbenchImport}=await loadOwned('prepare-import.ts');
const {handleWorkbenchUploadRequest}=await loadOwned('upload-rpc.ts');
const {receiveWorkbenchArtifact}=await loadOwned('upload-artifact.ts');
const {mountProfileWorkbenchImportHost}=await loadOwned('profile-import-host.ts');
const {createProfileWorkbenchTarget}=await loadOwned('profile-target.ts');
const {WorkbenchOperationRunner}=await loadOwned('operation-runner.ts');
const official=async name=>import(pathToFileURL(officialRequire.resolve(name)).href);
const {Context}=await official('@deepseek-ai/cordis');
const {default:Storage}=await official('@deepseek-ai/dsh-storage');
const JsonStorage=await official('@deepseek-ai/dsh-storage-json');
const StorageDomain=await official('@deepseek-ai/dsh-storage-domain');
async function bootJournal(root){const ctx=new Context();await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(StorageDomain,{backend:'json'});return ctx;}
const descriptor={id:'workdsh.install-probe',title:'安装核验探针',description:'',protocolVersion:'1.0',layout:'full-page',
 hostCompatibility:{sdk:'^1.0.0',harness:'0.2.1-rc.1'},capabilities:[]};
// Actual published package manager and pnpm in a synthetic profile. This fixture
// verifies package mutation, not SDK registration, installed Desktop or GUI.
test('official manager installs, updates and removes a local archive without evaluating its entry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workdsh-official-install-'));
 const profile=join(root,'profile'),source=join(root,'source'),packed=join(root,'packed');
 try{
  await Promise.all([mkdir(profile),mkdir(source),mkdir(packed)]);
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'isolated-workdsh-profile',version:'0.0.0',private:true,dsh:{bundles:[]}}));
  await writeFile(join(profile,'pnpm-workspace.yaml'),'packages: []\n');
  const context={profile:'workdsh-isolated-test',dir:profile,cwd:root,home:root,installAnchor:anchor};
  const options={command:process.execPath,args:[pnpm],execution:'service',outputBytes:16384,activateNewBundles:false,lockWaitMs:5000,idleTimeoutMs:15000,lookupTimeoutMs:5000};
  const profileContext={name:context.profile,dir:profile,cwd:root,home:root,installAnchor:anchor,packageManager:{command:process.execPath,args:[pnpm],env:{}}};
  const nativeInstall=await createProfileWorkbenchInstaller({get:()=>profileContext,fiber:{assertActive(){}}},()=>{});
  await assert.rejects(nativeInstall(join(source,'not-retained.tgz')));
  let previous;
  for(const version of ['0.1.0','0.1.1']){
   await writeFile(join(source,'package.json'),JSON.stringify({name:'workdsh-install-probe',version,type:'module',files:['index.js','index.d.ts','client.js','client.d.ts','cordis.patch.yml'],
    exports:{'.':{default:'./index.js',types:'./index.d.ts'},'./client':{default:'./client.js',types:'./client.d.ts'}},
    dsh:{bundle:{patch:'./cordis.patch.yml'},client:{platform:'web'}},workdsh:{workbench:descriptor}}));
   await writeFile(join(source,'index.js'),`throw new Error('entry-must-not-run-${version}');`);
   await Promise.all(['index.d.ts','client.d.ts'].map(name=>writeFile(join(source,name),'export {};')));
   await writeFile(join(source,'client.js'),'throw new Error("client-must-not-run");');
   await writeFile(join(source,'cordis.patch.yml'),'- insert: []\n');
   await promisify(execFile)(process.execPath,[pnpm,'--dir',source,'pack','--pack-destination',packed],{cwd:source,timeout:15000});
   const archive=join(packed,`workdsh-install-probe-${version}.tgz`);
   const candidate=await inspectWorkbenchPackageArtifact(archive,{packageName:'workdsh-install-probe',version,workbenchId:descriptor.id});
   let verifiedCommits=0;
   const request={installationRoot:profile,archivePath:archive,
    expected:{packageName:'workdsh-install-probe',version,workbenchId:descriptor.id},
    host:{harnessVersion:'0.2.1-rc.1',cordisVersion:'4.0.5'},isCompatible:()=>true,authorize:()=>{},
    install:async (retained,signal,beforeInstall)=>{
     assert.notEqual(retained,archive);
     const before=await readFile(join(profile,'package.json'),'utf8');
     await assert.rejects(nativeInstall(retained,signal,async()=>{throw new Error('stale-baseline');}),/stale-baseline/);
     assert.equal(await readFile(join(profile,'package.json'),'utf8'),before,'rejected check inside official lock must not mutate profile');
     const outcome=await nativeInstall(retained,signal,beforeInstall);
     assert.equal(outcome.exitCode,0,outcome.output); return outcome;
    },archives:{resolve:(name,requestedVersion)=>{if(previous && previous.version===requestedVersion)return previous;throw new Error('workbench/installation-archive-unavailable');},retainVerified:async facts=>{await verifyInstalledWorkbenchArtifact(profile,facts.path,facts);verifiedCommits++;}}};
   let invalidInstallCalls=0;
   const blockedInstall=async()=>{invalidInstallCalls++;throw new Error('unexpected install');};
   await assert.rejects(importWorkbenchArchive({...request,isCompatible:()=>false,install:blockedInstall}),/incompatible-package/);
   await assert.rejects(importWorkbenchArchive({...request,authorize:()=>{throw new Error('not-authorized');},install:blockedInstall}),/not-authorized/);
   await assert.rejects(importWorkbenchArchive({...request,archives:{...request.archives,resolve:()=>({sha256:'0'.repeat(64),workbenchId:descriptor.id,path:archive})},install:blockedInstall}),/installation-version-conflict/);
   assert.equal(invalidInstallCalls,0);
   await assert.rejects(importWorkbenchArchive({...request,install:async()=>({exitCode:1})}),/package-install-failed/);
   assert.equal(verifiedCommits,0,'failed manager result never commits installation authority');
   await assert.rejects(importWorkbenchArchive({...request,install:async()=>({exitCode:0})}));
   assert.equal(verifiedCommits,0,'success exit without matching installed files is insufficient');
   const operationTarget={hostId:'host',installationId:'installation',profileId:context.profile,harnessVersion:'0.2.1-rc.1'};
   let installerCalls=0;
   const adapter=createWorkbenchImportOperationAdapter({...request,expected:{...request.expected,sha256:candidate.receipt.sha256},target:operationTarget,
    install:async(...args)=>{installerCalls++;return request.install(...args);}});
   const operation={kind:previous?'update':'install',expectedInstalledHash:previous?.sha256,inputHash:candidate.receipt.sha256,target:operationTarget};
   if(previous){
    await assert.rejects(adapter.preflight({...operation,expectedInstalledHash:undefined}),/installation-baseline-unavailable/);
    await assert.rejects(adapter.preflight({...operation,expectedInstalledHash:'0'.repeat(64)}),/installation-baseline-conflict/);
   }
   const actor={principalId:'installer',organizationId:'personal',requestId:'official-install-test',resolvedBy:'trusted-test'};
   const intent={...operation,candidate:{...candidate.receipt,workbenchId:descriptor.id},id:`install-${version}`,iterationId:`iteration-${version}`};
   const journalRoot=join(root,`journal-${version}`);
   let storageContext=await bootJournal(journalRoot),journal;
   try {
    journal=await WorkbenchDevelopmentOperations.open(storageContext.storageDomain,actor,'install-probe');
    // Drop the return only after the official manager and installed-file verifier committed.
    const interrupted={...adapter,execute:async(...args)=>{await adapter.execute(...args);throw new Error('lost-install-return');}};
    let runner=new WorkbenchOperationRunner(journal,interrupted,()=>{});
    assert.equal((await runner.execute(intent,actor)).state,'unknown');
    assert.equal(installerCalls,1);
    await journal.close();await storageContext.fiber.dispose();
    storageContext=await bootJournal(journalRoot);
    journal=await WorkbenchDevelopmentOperations.open(storageContext.storageDomain,actor,'install-probe');
    runner=new WorkbenchOperationRunner(journal,adapter,()=>{});
    assert.equal((await runner.execute(intent,actor)).state,'unknown','retry must preserve uncertain committed state');
    assert.equal(installerCalls,1);
    const restored=await runner.reconcile(intent.id,actor);
    assert.equal(restored.state,'succeeded');assert.deepEqual(restored.receipt.package,candidate.receipt);
    assert.equal(installerCalls,1,'cold recovery must not replay installation');
    assert.equal(verifiedCommits,2);
    await journal.close();await storageContext.fiber.dispose();
    storageContext=await bootJournal(journalRoot);
    journal=await WorkbenchDevelopmentOperations.open(storageContext.storageDomain,actor,'install-probe');
    assert.deepEqual(journal.list()[0].receipt.package,candidate.receipt,'verified recovery receipt survives another restart');
    assert.deepEqual(journal.list()[0].candidate,{...candidate.receipt,workbenchId:descriptor.id},'candidate identity survives restart for recovery without file reselection');
   } finally {await journal?.close();await storageContext.fiber.dispose();}
   const installed=JSON.parse(await readFile(join(profile,'node_modules/workdsh-install-probe/package.json'),'utf8'));
   assert.equal(installed.version,version);
   assert.match(await readFile(join(profile,'node_modules/workdsh-install-probe/index.js'),'utf8'),new RegExp(version.replaceAll('.','\\.')));
   assert.ok(JSON.parse(await readFile(join(profile,'package.json'),'utf8')).dependencies['workdsh-install-probe']);
   const verified=await verifyInstalledWorkbenchArtifact(profile,archive,{packageName:candidate.receipt.packageName,version,
    sha256:candidate.receipt.sha256,workbenchId:descriptor.id});
   assert.deepEqual(verified.receipt,candidate.receipt);
   previous={...candidate.receipt,workbenchId:descriptor.id,path:archive};
   await assert.rejects(adapter.preflight(operation),/installation-(?:already-present|baseline)/);
  }
  const removed=await runPluginCommand(context,['remove','workdsh-install-probe','--config.offline=true'],options);
  assert.equal(removed.exitCode,0,removed.output);
  const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));
  assert.equal(manifest.dependencies?.['workdsh-install-probe'],undefined);
  // Call the mounted Host service itself using official storage and the real installer.
  const storageContext=await bootJournal(join(root,'service-journal'));
  const actor={principalId:'service-user',organizationId:'personal',requestId:'service-test',resolvedBy:'trusted-test'};
  let principal=actor.principalId;const disposers=[];const provided=new Map();
  const identity={resolve:async()=>({...actor,principalId:principal}),profile:()=>({principalId:principal,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy}),membership:()=>({state:'active'})};
  const ctx={get:key=>key==='profileContext'?profileContext:key==='storageDomain'?storageContext.storageDomain:key==='workdshIdentity'?identity:provided.get(key),
   fiber:{assertActive(){}},effect:fn=>disposers.push(fn()),provide:(key,value)=>provided.set(key,value)};
  const target=await (await createProfileWorkbenchTarget(ctx))(actor);
  const archive=join(packed,'workdsh-install-probe-0.1.1.tgz');
  const candidate=await inspectWorkbenchPackageArtifact(archive,{packageName:'workdsh-install-probe',version:'0.1.1',workbenchId:descriptor.id});
  const expected={...candidate.receipt,workbenchId:descriptor.id};
  const uploaded=await receiveWorkbenchArtifact(profile,new Response(await readFile(archive)).body,expected,()=>{});
  assert.equal(uploaded.expected.sha256,candidate.receipt.sha256);
  assert.notEqual(uploaded.path,archive);
  const discovered=await receiveWorkbenchArtifact(profile,new Response(await readFile(archive)).body,undefined,()=>{});
  assert.deepEqual(discovered.expected,{...candidate.receipt,workbenchId:descriptor.id});
  assert.equal(discovered.path,uploaded.path);
  const metadata={developmentId:'service-development',packageName:expected.packageName,version:expected.version,workbenchId:expected.workbenchId};
  const uploadRequest=(fields=metadata)=>new Request('https://workdsh.invalid/api/workdsh-workbench-upload',{method:'POST',headers:{'content-type':'application/octet-stream','x-workdsh-upload':JSON.stringify(fields)},body:new Uint8Array([1])});
  const response=await handleWorkbenchUploadRequest(new Request('https://workdsh.invalid/api/workdsh-workbench-upload',{method:'POST',headers:{'content-type':'application/octet-stream','x-workdsh-upload':JSON.stringify(metadata)},body:await readFile(archive)}),profile,async()=>()=>{});
  assert.equal(response.status,200);const uploadReply=await response.json();
  assert.equal(uploadReply.value.sha256,candidate.receipt.sha256);assert.equal(uploadReply.value.path,undefined);
  let accesses=0;
  assert.equal((await handleWorkbenchUploadRequest(uploadRequest({...metadata,path:archive}),profile,async()=>{accesses++;return()=>{};})).status,400);
  assert.equal(accesses,0);
  assert.equal((await handleWorkbenchUploadRequest(uploadRequest(),profile,async()=>{throw new Error('workbench/development-owner-mismatch');})).status,403);

  await assert.rejects(receiveWorkbenchArtifact(profile,new Response(new Uint8Array(8*1024*1024+1)).body,expected,()=>{}),/package-archive-size-limit/);
  let uploadAuthorized=true;
  const revoked=new ReadableStream({pull(controller){uploadAuthorized=false;controller.enqueue(new Uint8Array([1]));}});
  await assert.rejects(receiveWorkbenchArtifact(profile,revoked,expected,()=>{if(!uploadAuthorized)throw new Error('workbench/development-access-denied');}),/development-access-denied/);
  assert.deepEqual(await readdir(join(profile,'.workdsh-workbench-uploads')),[],'failed upload leaves no staging file');
  const abort=new AbortController();abort.abort();
  await assert.rejects(receiveWorkbenchArtifact(profile,new Response('data').body,expected,()=>{},abort.signal),error=>error.name==='AbortError');
  const entries=[{title:'安装探针',development:{id:'service-development',workbenchId:descriptor.id,packageName:'workdsh-install-probe',iterationId:'service-iteration',requirementsRevision:'service-requirements',target}}];
  const archives={resolve:()=>{throw new Error('workbench/installation-archive-unavailable');},retainVerified:async facts=>verifyInstalledWorkbenchArtifact(profile,facts.path,facts)};
  try {
   const service=await mountProfileWorkbenchImportHost(ctx,{list:async()=>principal===actor.principalId?entries:[]},()=>true,'4.0.5',archives);
   assert.equal(provided.get('workdshWorkbenchImport'),service);
   const request={developmentId:'service-development',intent:{id:'service-install',iterationId:'service-iteration',kind:'install',target,inputHash:expected.sha256},expected,archivePath:uploaded.path};
   await assert.rejects(service.run({...request,developmentId:'foreign-development'}),/development-owner-mismatch/);
   await assert.rejects(service.run({...request,expected:{...expected,packageName:'other-package'}}),/development-owner-mismatch/);
   const prepareInput={installationRoot:profile,expected,host:{harnessVersion:'0.2.1-rc.1',cordisVersion:'4.0.5'},archives,isCompatible:()=>true,authorize:()=>{}};
   assert.equal((await prepareWorkbenchImport(prepareInput)).kind,'install');
   const installed=await service.run(request);
   assert.equal(installed.state,'succeeded');assert.deepEqual(installed.receipt.package,candidate.receipt);
   archives.resolve=()=>({path:uploaded.path,sha256:expected.sha256,workbenchId:descriptor.id});
   let enabled=false,activationCalls=0;
   const manager={listBundles:async()=>[{name:expected.packageName,version:expected.version,installed:true,availability:'profile',enabled}],setBundleEnabled:async(name,value)=>{activationCalls++;enabled=value;return {target:name,application:'applied'};}};
   const activation={installationRoot:profile,expected,archives,manager,isCompatible:()=>true,authorize:()=>{},enabled:true};
   const activationResult=await setWorkbenchBundleEnabled(activation);assert.equal(activationResult.confirmed,true);assert.equal(activationResult.selected,true);
   assert.equal((await setWorkbenchBundleEnabled({...activation,enabled:false})).selected,false);
   await assert.rejects(setWorkbenchBundleEnabled({...activation,expected:{...expected,sha256:'0'.repeat(64)}}),/installation-changed/);
   await assert.rejects(setWorkbenchBundleEnabled({...activation,isCompatible:()=>false}),/incompatible-package/);
   assert.equal(activationCalls,2);
   const prepared=await prepareWorkbenchImport(prepareInput);assert.equal(prepared.kind,'update');assert.equal(prepared.expectedInstalledHash,expected.sha256);
   await assert.rejects(prepareWorkbenchImport({...prepareInput,authorize:()=>{throw new Error('workbench/development-access-denied');}}),/development-access-denied/);
   const records=await service.list('service-development');assert.equal(records[0].candidate.version,'0.1.1');assert.equal(records[0].actor,undefined);assert.equal(records[0].target,undefined);
   assert.equal((await service.run(request)).state,'succeeded','duplicate service call reads durable success');
   assert.equal((await service.run({...request,recover:true,archivePath:undefined})).state,'succeeded');
   await assert.rejects(service.run({...request,recover:true,expected:{...expected,version:'9.9.9'}}),/operation-input-conflict/);
   await assert.rejects(service.run({...request,recover:true,intent:{...request.intent,iterationId:'foreign-iteration'}}),/operation-input-conflict/);
   principal='switched-user';
   await assert.rejects(service.run({...request,recover:true}),/development-owner-mismatch/);
  } finally {for(const dispose of disposers.reverse())await dispose?.();await storageContext.fiber.dispose();}

 }finally{await rm(root,{recursive:true,force:true});}
});

// A separate process uses the same published Profile lock as the official CLI.
// The competitor changes a baseline marker; no package installation is faked.
test('native installer checks baseline only after a competing process releases the official lock',async()=>{
 const root=realpathSync(await mkdtemp(join(tmpdir(),'workdsh-profile-lock-')));
 let competitor;
 try{
  const manifest=join(root,'package.json'),archives=join(root,'.workdsh-workbench-archives');
  await mkdir(archives);await writeFile(manifest,JSON.stringify({name:'lock-probe',private:true,baseline:'old'}));
  const archive=join(archives,'a'.repeat(64)+'.tgz');await writeFile(archive,'not consumed because baseline check rejects');
  const atomic=pathToFileURL(officialRequire.resolve('@deepseek-ai/dsh-atomic-write')).href;
  const script=`import {withFileLock} from ${JSON.stringify(atomic)};import {readFile,writeFile} from 'node:fs/promises';import {once} from 'node:events';await withFileLock(${JSON.stringify(manifest)},async()=>{process.send('locked');await once(process,'message');const value=JSON.parse(await readFile(${JSON.stringify(manifest)},'utf8'));value.baseline='new';await writeFile(${JSON.stringify(manifest)},JSON.stringify(value));});process.disconnect();`;
  competitor=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','pipe','ipc']});
  const ready=await Promise.race([once(competitor,'message'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('competitor did not acquire lock')),5000);timer.unref();})]);
  assert.equal(ready[0],'locked');
  const profile={name:'lock-probe',dir:root,cwd:root,home:root,installAnchor:anchor,packageManager:{command:process.execPath,args:[pnpm],env:{}}};
  const installer=await createProfileWorkbenchInstaller({get:()=>profile,fiber:{assertActive(){}}},()=>{});
  let checked=false;
  const pending=installer(archive,undefined,async()=>{checked=true;const current=JSON.parse(await readFile(manifest,'utf8'));assert.equal(current.baseline,'new');throw new Error('stale-baseline-after-lock');});
  const rejected=assert.rejects(pending,/stale-baseline-after-lock/);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(checked,false,'baseline callback cannot run outside the competing lock');
  const exited=once(competitor,'exit');competitor.send('release');await exited;await rejected;
  assert.equal(checked,true);assert.equal(JSON.parse(await readFile(manifest,'utf8')).baseline,'new');
 }finally{if(competitor?.exitCode===null){const exited=once(competitor,'exit');competitor.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true});}
});

test('competing real package update invalidates queued native update baseline',async()=>{
 const root=realpathSync(await mkdtemp(join(tmpdir(),'workdsh-competing-update-')));
 let competitor;
 try{
  const profile=join(root,'profile'),source=join(root,'source'),packed=join(root,'packed');
  await Promise.all([mkdir(profile),mkdir(source),mkdir(packed)]);
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'competing-profile',private:true,dsh:{bundles:[]}}));
  await writeFile(join(profile,'pnpm-workspace.yaml'),'packages: []\n');
  const tarballs=[];
  for(const version of ['1.0.0','1.0.1','1.0.2']){
   await writeFile(join(source,'package.json'),JSON.stringify({name:'workdsh-lock-update-probe',version,files:['index.js'],main:'index.js'}));
   await writeFile(join(source,'index.js'),`throw new Error('probe entry must not execute');`);
   await promisify(execFile)(process.execPath,[pnpm,'--dir',source,'pack','--pack-destination',packed],{cwd:source,timeout:15000});
   tarballs.push(join(packed,`workdsh-lock-update-probe-${version}.tgz`));
  }
  const context={profile:'competing-profile',dir:profile,cwd:root,home:root,installAnchor:anchor};
  const options={command:process.execPath,args:[pnpm],env:{npm_config_offline:'true'},execution:'service',outputBytes:4096,activateNewBundles:false,lockWaitMs:5000,idleTimeoutMs:15000,lookupTimeoutMs:5000};
  assert.equal((await runPluginCommand(context,['add',tarballs[0],'--ignore-scripts'],options)).exitCode,0);
  const installed=join(profile,'node_modules/workdsh-lock-update-probe/package.json');
  assert.equal(JSON.parse(await readFile(installed,'utf8')).version,'1.0.0');
  const archives=join(profile,'.workdsh-workbench-archives');await mkdir(archives);
  const candidate=join(archives,'b'.repeat(64)+'.tgz');await writeFile(candidate,await readFile(tarballs[2]));
  const atomic=pathToFileURL(officialRequire.resolve('@deepseek-ai/dsh-atomic-write')).href;
  const operations=pathToFileURL(officialRequire.resolve('@deepseek-ai/dsh-plugin-manager/operations')).href;
  const script=`import {withFileLock} from ${JSON.stringify(atomic)};import {runProfilePnpm} from ${JSON.stringify(operations)};import {once} from 'node:events';await withFileLock(${JSON.stringify(join(profile,'package.json'))},async()=>{process.send('locked');await once(process,'message');const result=await runProfilePnpm(${JSON.stringify(context)},${JSON.stringify(['add',tarballs[1],'--ignore-scripts'])},${JSON.stringify(options)});if(result.exitCode!==0)throw new Error('competitor installation failed');});process.disconnect();`;
  competitor=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','pipe','ipc']});
  const ready=await Promise.race([once(competitor,'message'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('competitor lock unavailable')),5000);timer.unref();})]);assert.equal(ready[0],'locked');
  const profileContext={name:context.profile,dir:profile,cwd:root,home:root,installAnchor:anchor,packageManager:{command:process.execPath,args:[pnpm],env:{npm_config_offline:'true'}}};
  const installer=await createProfileWorkbenchInstaller({get:()=>profileContext,fiber:{assertActive(){}}},()=>{});
  let checked=false;
  const pending=installer(candidate,undefined,async()=>{checked=true;const version=JSON.parse(await readFile(installed,'utf8')).version;if(version!=='1.0.0')throw new Error('workbench/installation-baseline-conflict');});
  const rejected=assert.rejects(pending,/installation-baseline-conflict/);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(checked,false);
  const exited=once(competitor,'exit');competitor.send('update');const [code]=await exited;assert.equal(code,0);await rejected;
  assert.equal(checked,true);assert.equal(JSON.parse(await readFile(installed,'utf8')).version,'1.0.1','queued 1.0.2 must not replace competitor update');
 }finally{if(competitor?.exitCode===null){const exited=once(competitor,'exit');competitor.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true});}
});
