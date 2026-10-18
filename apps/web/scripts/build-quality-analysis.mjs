import {build} from 'esbuild';
import {readFile,mkdir,readdir,copyFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,relative,join} from 'node:path';
const root=new URL('../../../packages/plugins/quality-analysis/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
const external=Object.keys({...manifest.dependencies,...manifest.peerDependencies});
await copyFile(new URL('../../../packages/tabular/dist/THIRD-PARTY-LICENSES.txt',import.meta.url),new URL('dist/THIRD-PARTY-LICENSES.txt',root));
for(const name of ['index','runtime/artifact-worker','runtime/analysis-worker','runtime/csv-worker','runtime/xlsx-worker']) {
 const outfile=name==='index'?'index':name.split('/').at(-1);
 await build({entryPoints:[fileURLToPath(new URL('src/'+name+'.ts',root))],outfile:fileURLToPath(new URL('dist/'+outfile+'.js',root)),bundle:true,platform:'node',format:'esm',external});
}
const dist=fileURLToPath(new URL('dist/',root)), destination=join(dist,'contracts');await mkdir(destination,{recursive:true});
for(const name of await readdir(new URL('../../../packages/contracts/dist/',import.meta.url)))if(name.endsWith('.d.ts'))await copyFile(new URL('../../../packages/contracts/dist/'+name,import.meta.url),join(destination,name));
async function rewrite(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory()){if(path!==destination)await rewrite(path);continue;}if(!entry.name.endsWith('.d.ts'))continue;let target=relative(dirname(path),join(destination,'index.js')).replaceAll('\\','/');if(!target.startsWith('.'))target='./'+target;await writeFile(path,(await readFile(path,'utf8')).replace(/(['"])workdsh-contracts\1/g,JSON.stringify(target)));}}
await rewrite(dist);
const client=await build({entryPoints:[fileURLToPath(new URL('src/client.tsx',root))],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022',external:['react','react/jsx-runtime','workdsh-plugin-library/client','workdsh-plugin-workbenches/client']});
await writeFile(new URL('dist/client.browser.js',root),`window.__ModuleLoader__.load({id:"workdsh-plugin-quality-analysis",factory:function(require){const module={exports:{}};\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
