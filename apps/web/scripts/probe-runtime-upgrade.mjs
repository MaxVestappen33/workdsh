/** Isolated published-runtime compatibility probe. Never edits a live Profile,
 * upstream.json, official bundles, or the source checkout's dependency graph. */
import {mkdtemp,cp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const source=fileURLToPath(new URL('../../../',import.meta.url));
const target=process.argv[2];
if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(target??''))throw Error('Usage: node probe-runtime-upgrade.mjs <published-version>');
if(target!=='0.2.1-rc.1')throw Error('This probe currently pins the reviewed rc.1 vendor baseline only.');
const root=await mkdtemp(join(tmpdir(),'workdsh-runtime-upgrade-'));
const web=join(root,'apps/web');await mkdir(web,{recursive:true});
const ignored=new Set(['node_modules','.git','.artifacts','dist','coverage','.cache']);
const filter=path=>!ignored.has(basename(path));
await cp(join(source,'packages'),join(root,'packages'),{recursive:true,filter});
for(const name of ['scripts','tests'])await cp(join(source,'apps/web',name),join(web,name),{recursive:true,filter});
await cp(join(source,'apps/web/package.json'),join(web,'package.json'));
await cp(join(source,'apps/web/pnpm-workspace.yaml'),join(web,'pnpm-workspace.yaml'));
// Only the owned packages are in this probe. No copied sessions or credentials.
await writeFile(join(web,'pnpm-workspace.yaml'),"packages:\n  - ../../packages/*\n  - ../../packages/plugins/*\n  - ../../packages/providers/*\n  - '!../../packages/enterprise-connection'\n");
const vendors={'@deepseek-ai/cordis':'4.0.5','@deepseek-ai/cosmokit':'1.8.6','@deepseek-ai/schemastery':'3.18.5',
 '@deepseek-ai/cordis-plugin-group':'1.0.5','@deepseek-ai/cordis-plugin-hmr':'1.0.20','@deepseek-ai/cordis-plugin-include':'1.0.10',
 '@deepseek-ai/cordis-plugin-loader':'1.0.6','@deepseek-ai/cordis-plugin-logger-console':'1.0.5','@deepseek-ai/cordis-plugin-timer':'1.1.7'};
async function rewrite(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
 const path=join(directory,entry.name);if(entry.isDirectory()){await rewrite(path);continue;}
 if(entry.name!=='package.json')continue;
 const pkg=JSON.parse(await readFile(path,'utf8'));
 for(const fields of [pkg.dependencies,pkg.devDependencies,pkg.peerDependencies,pkg.optionalDependencies,pkg.pnpm?.overrides]){
  if(!fields)continue;
  for(const name of Object.keys(fields))if(name.startsWith('@deepseek-ai/dsh'))fields[name]=target;else if(vendors[name])fields[name]=vendors[name];
 }
 // Probe is intentionally not a runtime composer; source-specific postinstall
 // scripts must not mutate official packages or resolve the original checkout.
 delete pkg.scripts?.postinstall;
 await writeFile(path,JSON.stringify(pkg,null,2)+'\n');
}}
await rewrite(join(root,'packages'));await rewrite(web);
const upstream=JSON.parse(await readFile(join(source,'upstream.json'),'utf8'));upstream.version=target;await writeFile(join(root,'upstream.json'),JSON.stringify(upstream,null,2));
const report={target,root,source,liveEnvironmentChanged:false,officialBundlePatched:false,steps:[]};
const reportFile=join(root,'compatibility-report.json');
await writeFile(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({root,reportFile}));
const pnpm=resolve(source,'apps/web/node_modules/pnpm/bin/pnpm.cjs');
const env={...process.env,PATH:resolve(process.execPath,'..')+':'+process.env.PATH};
async function step(name,args){
 const log=join(root,name+'.log');const chunks=[];const started=Date.now();
 const child=spawn(process.execPath,[pnpm,...args],{cwd:web,env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>chunks.push(d));child.stderr.on('data',d=>chunks.push(d));
 const code=await new Promise((done,fail)=>{child.on('error',fail);child.on('close',done)});
 await writeFile(log,Buffer.concat(chunks));report.steps.push({name,code,elapsedMs:Date.now()-started,log});
 await writeFile(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify(report.steps.at(-1)));return code===0;
}
if(!await step('install',['install','--ignore-scripts','--no-frozen-lockfile']))process.exit(1);
// Build dependency declarations first; do not run the graphical preview or a paid model.
await step('dependency-build',['--filter','workdsh-plugin-quality-analysis...','--filter','workdsh-plugin-skills...','build']);
for(const name of ['workdsh-plugin-workbenches','workdsh-plugin-skills','workdsh-provider-identity-local','workdsh-plugin-quality-analysis']){
 await step(name+'-typecheck',['--filter',name,'typecheck']);
}
await step('workbenches-tests',['test:workbenches']);
await step('native-layout-api',['exec','node',join(source,'apps/web/scripts/probe-native-conversation-layout.mjs'),join(root,'packages/plugins/workbenches'),join(root,'native-layout-api-report.json')]);
try{report.nativeLayout=JSON.parse(await readFile(join(root,'native-layout-api-report.json'),'utf8'));}catch{report.nativeLayout={verified:false};}
const frame=JSON.parse(await readFile(join(source,'apps/web/scripts/native-workbench-frame-patch.json'),'utf8'));
const require=createRequire(join(root,'packages/plugins/workbenches/package.json'));
const actual=JSON.parse(await readFile(require.resolve(frame.package+'/package.json'),'utf8'));
report.nativeFrame={adapterVersion:frame.version,runtimeVersion:actual.version,compatible:frame.version===actual.version,
 reason:frame.version===actual.version?'Exact-byte validation still required.':'Current adapter is not authorized for this runtime; no patch applied.'};
report.readyToSwitch=false;
report.sourceChecksPassed=report.steps.every(step=>step.code===0);
report.runtimeVerified=false;report.uiVerified=false;
await writeFile(reportFile,JSON.stringify(report,null,2));
process.exitCode=report.sourceChecksPassed?0:1;
console.log('Probe complete. Inspect the report; source checks do not prove runtime or UI compatibility.');
