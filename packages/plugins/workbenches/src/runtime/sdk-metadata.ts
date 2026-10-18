import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,join,relative,isAbsolute} from 'node:path';

/** Locate public SDK artifacts through the same installation anchor as Loader.
 * Reads metadata only: neither resolving nor advertising an export executes it. */
export async function readWorkbenchSdkMetadata(installAnchor:string){
 try{
  const manifestPath=await realpath(createRequire(installAnchor).resolve('workdsh-plugin-workbenches/package.json'));
  const packageDirectory=dirname(manifestPath),pkg=JSON.parse(await readFile(manifestPath,'utf8'));
  if(pkg.name!=='workdsh-plugin-workbenches'||typeof pkg.version!=='string'||!pkg.version.trim())throw Error('invalid-sdk-metadata');
  const publicFile=async(value:unknown)=>{
   if(typeof value!=='string'||!value.startsWith('./')||value.includes('\\'))throw Error('invalid-sdk-export');
   const path=await realpath(join(packageDirectory,value));const child=relative(packageDirectory,path);
   if(child==='..'||child.startsWith('../')||isAbsolute(child))throw Error('sdk-export-outside');
   return path;
  };
  const [readme,hostTypes,clientTypes]=await Promise.all([publicFile('./README.md'),publicFile(pkg.exports?.['.']?.types),publicFile(pkg.exports?.['./client']?.types)]);
  const documentation=await readFile(readme,'utf8');
  const heading='## 业务包最短接入',start=documentation.indexOf(heading),end=start<0?-1:documentation.indexOf('\n## ',start+heading.length);
  const quickstart=start<0?undefined:documentation.slice(start,end<0?undefined:end).slice(0,12000);
  const delivery=pkg.exports?.['./delivery']==='./scripts/run-delivery.mjs'?await publicFile(pkg.exports['./delivery']):undefined;
  return {status:'available' as const,packageName:pkg.name as string,version:pkg.version as string,packageDirectory,readme,publicTypes:{host:hostTypes,client:clientTypes},
   quickstart,documentationSha256:createHash('sha256').update(documentation).digest('hex'),
   ...(delivery?{delivery:{command:process.execPath,runner:delivery,arguments:['<source.directory>'],execution:'official-development-tool-sandbox',stages:['build','startup-check','pack'],report:'diagnostic-only; not installation or page acceptance',usage:'Execute command + runner + arguments in the official development sandbox. The runner uses installed or bundled pnpm JavaScript through Node; system npm is not required. Do not read or copy its implementation unless the command reports a real error.'}}:{}),
   lookupPolicy:'Use the supplied quickstart and existing scaffold first. Read only public declarations needed by this iteration; recheck on version/fingerprint changes or actual interface errors. Never inspect private bundles.'};
 }catch{
  // An unavailable metadata lookup is not a claim that the running service is absent.
  return {status:'unavailable' as const,packageName:'workdsh-plugin-workbenches',errorCode:'workbench/sdk-metadata-unavailable'};
 }
}
