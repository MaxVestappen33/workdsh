import{spawn}from'node:child_process';
import{readFile,writeFile}from'node:fs/promises';
import{join}from'node:path';
import assert from'node:assert/strict';
import{createHash}from'node:crypto';
// This probe writes synthetic records. Require an explicit disposable Home.
const index=process.argv.indexOf('--home');
if(index<0||!process.argv[index+1])throw Error('Provide --home for an isolated test installation');
const home=process.argv[index+1],profile=join(home,'profiles/workdsh');
const child=spawn(process.execPath,[join(profile,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','workdsh','--no-open','--host','127.0.0.1','--port','0'],{env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:join(home,'agents')},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
try{
 const until=Date.now()+45000;let loginUrl;
 while(!(loginUrl=output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)?.[0])){if(child.exitCode!==null)throw Error('Profile exited before bootstrap');if(Date.now()>until)throw Error('Profile bootstrap timeout');await new Promise(r=>setTimeout(r,200));}
 const login=await fetch(loginUrl,{redirect:'manual'});assert.ok(login.status>=300&&login.status<400);
 const cookie=login.headers.getSetCookie().map(row=>row.split(';')[0]).join('; '),origin=new URL(loginUrl).origin;
 assert.equal((await fetch(origin,{headers:{cookie}})).status,200);
 let authority;
 for(let n=0;n<30;n++){
  const response=await fetch(origin+'/api/workdsh-workbench-registration',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({endpoint:'client-authority',payload:{packageName:'workdsh-plugin-quality-analysis'}})});
  const data=await response.json();if(response.ok&&data.ok){authority=data.value;break;}await new Promise(r=>setTimeout(r,300));
 }
 assert.ok(authority,'Quality workbench authority unavailable');assert.equal(authority.enabled,true);assert.equal(authority.compatible,true);assert.equal(authority.descriptor.id,'workdsh.quality-analysis');
 const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));
 assert.ok(manifest.dsh.profile.bundles.includes('workdsh-plugin-workbenches'));
async function rpc(path,endpoint,payload){const response=await fetch(origin+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({endpoint,payload}),signal:AbortSignal.timeout(60000)});const data=await response.json();if(!response.ok||!data.ok)throw Error('Release RPC failed '+endpoint+' '+(data.error?.code??response.status));return data.value;}
const q=(endpoint,payload)=>rpc('/api/workdsh-quality-records',endpoint,payload);
const record=await q('create',{title:'独立候选质量分析（测试数据）',operationId:'release-installed-demo-quality-v1'});
let runs=await q('runs',{recordId:record.id,offset:0,limit:20});
if(!runs.entries.length){
const file=await rpc('/api/workdsh-library','import',{name:'质量分析试用数据.csv',operationId:'release-installed-demo-csv-v1',mediaType:'text/csv',base64:Buffer.from('id,date,total,bad,unit,type\nINS-001,2026-10-10,100,5,piece,initial\nINS-002,2026-10-11,200,10,piece,initial\n').toString('base64')});
const detail=await q('get',{recordId:record.id});
const source=await q('import-library',{recordId:record.id,reference:{assetId:file.asset.id,revisionId:file.revision.id},format:'csv',tableKind:'inspections',headerRow:1,expectedGeneration:detail.generation});
if(source.status!=='ready'||source.inspectionRows!==2)throw Error('Import incomplete');
await q('configure',{recordId:record.id,title:record.title,sourceNamespace:'release-installed-demo',sourceSnapshotId:source.sourceSnapshotId,expectedGeneration:detail.generation,analysis:{inspectionsMapping:{inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'},rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},filter:{retestPolicy:'include-separately',trendGranularity:'day'}}});
const configured=await q('get',{recordId:record.id});
const analysis=await q('analyze',{recordId:record.id,expectedRevision:configured.revision});
if(analysis.status!=='saved')throw Error('Analysis incomplete');
runs=await q('runs',{recordId:record.id,offset:0,limit:20});
}
const run=runs.entries[0];
if(run.inspectedQuantity!==300||run.nonconformingQuantity!==15)throw Error('Unexpected totals');
const view=await q('run-view',{recordId:record.id,runId:run.runId,contentHash:run.contentHash,includeReport:true});
if(!view.markdown)throw Error('Report unavailable');
const report=await q('save-report',{recordId:record.id,runId:run.runId,contentHash:run.contentHash,title:'独立候选质量报告（测试数据）'});
 const original=await rpc('/api/workdsh-library','read-original',{assetId:report.assetId,revisionId:report.revisionId});
 const reportBytes=Buffer.from(original.base64,'base64');assert.equal(createHash('sha256').update(reportBytes).digest('hex'),report.sha256);assert.ok(reportBytes.toString('utf8').includes('300'));
 let starterSdkVerified=false;
 if(process.argv.includes('--starter')){
  const installedPlatform=JSON.parse(await readFile(join(profile,'node_modules/workdsh-plugin-workbenches/package.json'),'utf8'));
  const developmentId=`release-starter-${installedPlatform.version}`,requirementPath='/api/workdsh-workbench-requirements',developmentPath='/api/workdsh-workbench-development';
  let requirements=(await rpc(requirementPath,'history',{developmentId})).at(-1);
  if(!requirements)requirements=await rpc(requirementPath,'append',{developmentId,requirements:{title:'SDK生成验证',scenario:'测试隔离工作台',users:'测试用户',dataSources:'本地测试',workflow:'验证骨架',firstIteration:'生成入口',acceptance:'使用实际平台版本'}});
  let entry=(await rpc(developmentPath,'list',{})).find(row=>row.development.id===developmentId);
  if(!entry)entry=await rpc(developmentPath,'create',{developmentId,workbenchId:`release.sdk-probe.${installedPlatform.version}`,packageName:`workdsh-release-sdk-probe-${installedPlatform.version}`,expectedRequirementsRevision:requirements.id});
  const bound=await rpc(developmentPath,'ensure-session',{developmentId,expectedDevelopmentRevision:entry.development.revision});
  assert.ok(bound.development.source&&bound.development.session);
  const generated=JSON.parse(await readFile(join(bound.development.source.directory,'package.json'),'utf8'));
  const platform=JSON.parse(await readFile(join(profile,'node_modules/workdsh-plugin-workbenches/package.json'),'utf8'));
  assert.equal(generated.peerDependencies['workdsh-plugin-workbenches'],platform.version);
  assert.match(await readFile(join(bound.development.source.directory,'.npmrc'),'utf8'),/legacy-peer-deps=true/);starterSdkVerified=true;
 }
 const result={scope:'Independent release Profile HTTP/Host smoke; no GUI or model execution',web200:true,workbenchAuthority:true,starterSdkVerified,recordId:record.id,runId:run.runId,contentHash:run.contentHash,inspectedQuantity:run.inspectedQuantity,nonconformingQuantity:run.nonconformingQuantity,reportSaved:!!report,reportAssetId:report.assetId,reportRevisionId:report.revisionId,reportOriginalHashVerified:true,qualityVersion:authority.package.version,harness:JSON.parse(await readFile(join(profile,'node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version};
 let previous;try{previous=JSON.parse(await readFile(join(home,'installed-smoke-result.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous?.runId){assert.equal(result.runId,previous.runId);assert.equal(result.contentHash,previous.contentHash);if(previous.reportAssetId){assert.equal(result.reportAssetId,previous.reportAssetId);assert.equal(result.reportRevisionId,previous.reportRevisionId);}}
 await writeFile(join(home,'installed-smoke-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},3000).unref();await writeFile(join(home,'installed-smoke-log.txt'),output.replace(/token=[A-Za-z0-9_-]+/g,'token=[redacted]'));}
