import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../../../packages/plugins/workbenches/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
await build({entryPoints:[fileURLToPath(new URL('dist/index.js',root))],outfile:fileURLToPath(new URL('dist/index.js',root)),allowOverwrite:true,bundle:true,platform:'node',format:'esm',external:Object.keys({...manifest.dependencies,...manifest.peerDependencies})});

// Ship generated owned contract declarations with the SDK; external consumers
// must not resolve an unpublished workspace package to understand its types.
const {mkdir,readdir,copyFile,writeFile}=await import('node:fs/promises');
const {dirname,join,relative}=await import('node:path');
const contractTypes=fileURLToPath(new URL('../../../packages/contracts/dist/',import.meta.url));
const dist=fileURLToPath(new URL('dist/',root)), destination=join(dist,'contracts');
await mkdir(destination,{recursive:true});
for(const name of await readdir(contractTypes))if(name.endsWith('.d.ts'))await copyFile(join(contractTypes,name),join(destination,name));
async function rewrite(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory()){if(path!==destination)await rewrite(path);continue;}
    if(!entry.name.endsWith('.d.ts'))continue;
    const text=await readFile(path,'utf8');
    let target=relative(dirname(path),join(destination,'index.js')).replaceAll('\\','/');
    if(!target.startsWith('.'))target='./'+target;
    await writeFile(path,text.replace(/(['"])workdsh-contracts\1/g,JSON.stringify(target)));
  }
}
await rewrite(dist);
const {rm}=await import('node:fs/promises');
for(const name of await readdir(join(dist,'runtime')))if(name.endsWith('.js'))await rm(join(dist,'runtime',name));

// Official browser module envelope; React is supplied by the native renderer.
const client = await build({entryPoints:[fileURLToPath(new URL('src/client.tsx',root))],bundle:true,write:false,platform:'browser',format:'cjs',target:'es2022',external:['@deepseek-ai/dsh-client-ui-primitives','react','react/jsx-runtime','react-dom']});
await writeFile(new URL('dist/client.browser.js',root), `window.__ModuleLoader__.load({id:"workdsh-plugin-workbenches",factory:function(require){const module={exports:{}};\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
