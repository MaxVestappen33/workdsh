import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const root=new URL('../',import.meta.url).pathname;
export async function readOwnedManifests(base=root){
const directories=['../../packages/bundle','../../packages/contracts','../../packages/ui'];
for(const group of ['plugins','providers'])for(const entry of await readdir(join(base,'../../packages',group),{withFileTypes:true}))if(entry.isDirectory())directories.push('../../packages/'+group+'/'+entry.name);
const manifests=new Map();
for(const directory of directories){try{const manifest=JSON.parse(await readFile(join(base,directory,'package.json'),'utf8'));manifests.set(manifest.name,{manifest,directory});}catch(error){if(error.code!=='ENOENT')throw error;}}
return manifests;
}
export const defaults=['workdsh-provider-identity-local','workdsh-provider-browser-session','workdsh-plugin-audit','workdsh-plugin-access','workdsh-plugin-skills','workdsh-plugin-experts','workdsh-plugin-connectors','workdsh-plugin-library','workdsh-bundle'];
const allowed=new Set([...defaults,'workdsh-contracts','workdsh-ui','workdsh-plugin-workbench','workdsh-provider-backend-channel']);
/**
 * 构建期复用：默认包可以把某个独立安装功能的公开模块编译进自己的产物，只要该功能不成为运行期依赖。
 * 每条边必须逐条登记（消费方 -> 被复用功能），运行期字段 dependencies/optionalDependencies/peerDependencies
 * 仍受严格限制；library 侧另有测试断言 office 既不在 dependencies 中、也不出现在构建产物里。
 */
const buildOnlyReuse=new Set(['workdsh-plugin-library -> workdsh-plugin-office']);
export async function auditDefaultPluginDelivery(){
const manifests=await readOwnedManifests();
const installer=await readFile(join(root,'scripts/install-project-release.mjs'),'utf8');
const block=installer.match(/const defaultInstallOrder = \[([\s\S]*?)\];/)[1];
assert.deepEqual([...block.matchAll(/'([^']+)'/g)].map(match=>match[1]),defaults);
const packer=await readFile(join(root,'scripts/pack-project-release.mjs'),'utf8');
const packedDefaults=packer.match(/defaultPackages:\s*\[([^\]]+)\]/);
assert.ok(packedDefaults,'Release packer must declare the default installation policy');
assert.deepEqual([...packedDefaults[1].matchAll(/'([^']+)'/g)].map(match=>match[1]),defaults);
const packedOptional=packer.match(/optionalPackages:\s*\[([^\]]+)\]/);
assert.ok(packedOptional,'Release packer must declare optional packages');
assert.deepEqual([...packedOptional[1].matchAll(/'([^']+)'/g)].map(match=>match[1]),['workdsh-plugin-office','workdsh-plugin-projects','workdsh-plugin-activity']);
const {visited,edges}=assertDefaultOwnedClosure(manifests);
const proof={scope:'Unreleased Web personal installer/source package closure; not Desktop or published artifacts',defaultPackages:defaults,
 ownedClosure:[...visited].sort(),edges,externalEnterprisePackagesAbsent:true,
 optionalPersonalFeatures:['office','projects','activity'],developmentPreview:'Explicit full development composition retained',
 publishedReleaseArtifactsAudited:false,cleanInstalledProfileVerified:false};
return proof;
}

export function assertDefaultOwnedClosure(manifests){
const visited=new Set(), edges=[];
const visit=name=>{
 if(visited.has(name))return;visited.add(name);
 const row=manifests.get(name);assert.ok(row,'Owned package must have a manifest: '+name);
 // Also inspect build dependencies: bundled Client code can carry workspace-only modules.
 for(const field of ['dependencies','optionalDependencies','peerDependencies','devDependencies'])for(const dependency of Object.keys(row.manifest[field]??{})){
  if(!dependency.startsWith('workdsh-'))continue;
  const buildOnly=field==='devDependencies'&&buildOnlyReuse.has(name+' -> '+dependency);
  assert.ok(allowed.has(dependency)||buildOnly,'Default package closure contains an external feature: '+name+' -> '+dependency);
  edges.push({from:name,to:dependency,field,...(buildOnly?{buildOnly:true}:{})});
  // 构建期复用的模块被内联进消费方产物，不进入默认安装闭包，因此不再向下遍历；
  // 若同一功能同时出现在运行期字段里，上面那条断言仍会直接失败。
  if(!buildOnly)visit(dependency);
 }
};
for(const name of defaults)visit(name);
return {visited,edges};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const proof=await auditDefaultPluginDelivery();
await mkdir(join(root,'.artifacts/plugin-delivery'),{recursive:true});
await writeFile(join(root,'.artifacts/plugin-delivery/source-audit.json'),JSON.stringify(proof,null,2));
console.log(JSON.stringify({defaultPackages:defaults.length,ownedClosure:proof.ownedClosure.length,externalEnterprisePackagesAbsent:true}));
}
