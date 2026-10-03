import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {installedEnterprisePlugins} from '../src/enterprise-plugins.ts';
it('discovers explicitly installed enterprise code and rejects incompatible versions without granting identity',()=>{
 const root=mkdtempSync(join(tmpdir(),'enterprise-plugins-'));const name='workdsh-provider-identity-enterprise';
 try{
  expect(installedEnterprisePlugins(root,'0.2.0-rc.2')).toEqual([]);
  writeFileSync(join(root,'package.json'),JSON.stringify({dependencies:{[name]:'file:./account.tgz'}}));
  expect(()=>installedEnterprisePlugins(root,'0.2.0-rc.2')).toThrow('尚未完成安装');
  const directory=join(root,'node_modules',name);mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'package.json'),JSON.stringify({name,exports:{'./desktop':'./dist/desktop.js'},peerDependencies:{'@deepseek-ai/dsh':'0.2.0-rc.2'}}));
  expect(installedEnterprisePlugins(root,'0.2.0-rc.2')).toEqual([name]);
  expect(()=>installedEnterprisePlugins(root,'different')).toThrow('不兼容');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('discovers both bundled enterprise plugins only while their connection package remains explicitly installed',()=>{
 const root=mkdtempSync(join(tmpdir(),'enterprise-bundle-'));
 try{
  writeFileSync(join(root,'package.json'),JSON.stringify({dependencies:{'workdsh-enterprise-connection':'file:./enterprise.tgz'}}));
  const bundle=join(root,'node_modules','workdsh-enterprise-connection');mkdirSync(bundle,{recursive:true});writeFileSync(join(bundle,'package.json'),'{}');
  for(const name of ['workdsh-provider-identity-enterprise','workdsh-plugin-enterprise-collaboration']){
   const directory=join(bundle,'node_modules',name);mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'package.json'),JSON.stringify({name,exports:{'./desktop':'./dist/desktop.js'},peerDependencies:{'@deepseek-ai/dsh':'0.2.0-rc.2'}}));
  }
  expect(installedEnterprisePlugins(root,'0.2.0-rc.2')).toHaveLength(2);
  writeFileSync(join(root,'package.json'),'{}');expect(installedEnterprisePlugins(root,'0.2.0-rc.2')).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true})}
});
