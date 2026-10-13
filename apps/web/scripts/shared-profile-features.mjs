import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
// 清单里的 directory 与 Desktop 打包脚本的 PACKAGE_DIRECTORIES 同源，都是仓库根相对路径；
// 调用方按自己的根目录折算（apps/web 侧需要补 '../../'）。
const repository=new URL('../../',root);
export async function sharedProfileFeatures(){
 const plan=JSON.parse(await readFile(new URL('profiles/shared/workdsh-features.json',repository),'utf8'));
 const names=new Set();
 for(const feature of plan.features){
  if(names.has(feature.name))throw Error('Duplicate shared feature '+feature.name);
  names.add(feature.name);
  const manifest=JSON.parse(await readFile(new URL(feature.directory+'/package.json',repository),'utf8'));
  if(manifest.name!==feature.name)throw Error('Shared feature package mismatch '+feature.name);
 }
 return plan;
}
