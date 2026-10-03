/** Enterprise delivery uses explicitly installed packages; never copies account data. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export const enterprisePluginNames=['workdsh-provider-identity-enterprise','workdsh-plugin-enterprise-collaboration'] as const;
export function installedEnterprisePlugins(profile:string,version:string):string[]{
 if(!existsSync(join(profile,'package.json')))return [];
 const manifest=JSON.parse(readFileSync(join(profile,'package.json'),'utf8'));
 const bundle=manifest.dependencies?.['workdsh-enterprise-connection'];
 const bundleRoot=join(profile,'node_modules','workdsh-enterprise-connection');
 if(bundle&&!existsSync(join(bundleRoot,'package.json')))throw Error('企业连接包尚未完成安装');
 const names:string[]=[];
 for(const name of enterprisePluginNames){
  if(!bundle&&![manifest.dependencies,manifest.optionalDependencies].some(section=>section?.[name]))continue;
  const path=join(bundle?bundleRoot:profile,'node_modules',name,'package.json');
  if(!existsSync(path))throw Error('企业插件尚未完成安装：'+name);
  const pkg=JSON.parse(readFileSync(path,'utf8'));
  if(pkg.name!==name||!pkg.exports?.['./desktop']||pkg.peerDependencies?.['@deepseek-ai/dsh']!==version)throw Error('企业插件与当前 DSH 不兼容：'+name);
  names.push(name);
 }
 return names;
}
export async function composeInstalledEnterprisePlugins(source:string,target:string,version:string,node:string,pnpm:string):Promise<string[]>{
 const names=installedEnterprisePlugins(source,version);
 if(!names.includes(enterprisePluginNames[0]))throw Error('请先在个人空间的插件管理中安装企业账号插件，再进行企业登录');
 const manifestFile=join(target,'package.json');const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
 const archives=join(target,'enterprise-plugin-archives');mkdirSync(archives,{recursive:true,mode:0o700});
 manifest.dependencies??={};
 // Pack installed code through the bundled package manager; do not copy Profile files or credentials.
 for(const name of names){
  const sourceManifest=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
  const directory=join(sourceManifest.dependencies?.['workdsh-enterprise-connection']?join(source,'node_modules','workdsh-enterprise-connection'):source,'node_modules',name);
  const pkg=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
  await execute(node,[pnpm,'pack','--pack-destination',archives],{cwd:directory,timeout:240000});
  const filename=name+'-'+pkg.version+'.tgz';
  if(!readdirSync(archives).includes(filename))throw Error('企业插件导出失败：'+name);
  manifest.dependencies[name]='file:./enterprise-plugin-archives/'+filename;
 }
 for(const name of enterprisePluginNames)if(!names.includes(name)){delete manifest.dependencies[name];delete manifest.optionalDependencies?.[name];}
 writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 await execute(node,[pnpm,'--dir',target,'install','--prod','--force'],{cwd:target,timeout:240000});
 return names;
}
