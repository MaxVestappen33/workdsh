import {mkdir, cp, readFile, writeFile, access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(process.argv[2]??'');
const admin=resolve(process.argv[3]??join(root,'../workdsh-admin'));
if(!process.argv[2]||output===root||output===admin||output.startsWith(root+'/packages/')||output.startsWith(admin+'/server/'))throw Error('Explicit separate build-context directory required');
await mkdir(output,{recursive:false});await mkdir(join(output,'artifacts'));
const project=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const shared=JSON.parse(await readFile(join(root,'profiles/shared/workdsh-features.json'),'utf8'));
const version=project.devDependencies['@deepseek-ai/dsh'];
if(!version||shared.officialBundles.some(name=>project.pnpm.overrides[name]!==version))throw Error('Official runtime versions must match');
const directories=['packages/contracts','packages/ui','packages/providers/browser-session','packages/plugins/workbench','packages/plugins/audit','packages/plugins/access','packages/bundle',...shared.features.map(f=>f.directory),'packages/providers/identity-enterprise'];
const dependencies={'@deepseek-ai/dsh':version,'@deepseek-ai/dsh-base':version,'@deepseek-ai/dsh-web-app':version,'@deepseek-ai/dsh-deepseek-account':version,'@deepseek-ai/cordis-plugin-group':'1.0.4'};
const packs=[];
for(const directory of [...new Set(directories)]){
 const path=join(root,directory),manifest=JSON.parse(await readFile(join(path,'package.json'),'utf8'));
 for(const value of Object.values(manifest.exports??{})){
  const file=typeof value==='string'?value:value.default;
  if(file)await access(join(path,file));
 }
 execFileSync(process.execPath,[join(root,'node_modules/pnpm/bin/pnpm.cjs'),'pack','--pack-destination',join(output,'artifacts')],{cwd:path,stdio:'pipe'});
 const file=manifest.name+'-'+manifest.version+'.tgz';
 dependencies[manifest.name]='file:./artifacts/'+file;
 packs.push({name:manifest.name,file,sha256:createHash('sha256').update(await readFile(join(output,'artifacts',file))).digest('hex')});
 for(const [name,range] of Object.entries(manifest.peerDependencies??{})){
  if(name.startsWith('workdsh-')||manifest.peerDependenciesMeta?.[name]?.optional)continue;
  // Resolve peers to the exact source-workspace version; npm checks all ranges.
  const target=project.pnpm.overrides[name]??JSON.parse(await readFile(createRequire(join(path,'package.json')).resolve(name+'/package.json'),'utf8')).version;
  if(dependencies[name]&&dependencies[name]!==target)throw Error('Conflicting required runtime peer: '+name);
  dependencies[name]=target;
 }
}
// All official DSH packages come from published packages, including the complete Web patch.
// The lock is generated here once, then Linux Docker installs that exact lock.
const overrides=Object.fromEntries(Object.entries(project.pnpm.overrides).filter(([name])=>name.startsWith('@deepseek-ai/')));
await writeFile(join(output,'package.json'),JSON.stringify({name:'workdsh-enterprise-member-profile',private:true,type:'module',engines:project.engines,dependencies,overrides,dsh:{profile:{bundles:[]}}},null,2)+'\n');
execFileSync('npm',['install','--package-lock-only','--ignore-scripts','--prefer-offline','--no-audit','--no-fund'],{cwd:output,stdio:'pipe',timeout:600000});
const lock=JSON.parse(await readFile(join(output,'package-lock.json'),'utf8'));
for(const [path,entry] of Object.entries(lock.packages??{})){
 if(/(?:^|\/)node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path)&&entry.version!==version)throw Error('Mixed official DSH version in lock: '+path);
 if(entry.resolved?.includes('/Users/')||entry.resolved?.includes('/private/tmp/'))throw Error('Nonportable package resolution: '+path);
}
for(const file of ['Dockerfile','start.mjs','gateway.mjs','session-bridge.mjs','profile.mjs','environment.mjs','audit-runtime.mjs','probe-native-runtime.mjs'])await cp(new URL('./'+file,import.meta.url),join(output,file));
for(const file of ['user-entry.html','shared-entry-client.js','account-storage-fence.mjs'])await cp(join(admin,'deploy/docker',file),join(output,file));
await cp(join(root,'profiles/shared/workdsh-features.json'),join(output,'workdsh-features.json'));
await writeFile(join(output,'artifact-manifest.json'),JSON.stringify({kind:'unreleased-native-member-server',officialVersion:version,packages:packs,secretsIncluded:false,installedProfileCopied:false},null,2)+'\n');
console.log('Prepared portable member-server context with npm lock: '+output);
