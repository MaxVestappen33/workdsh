import {build} from 'esbuild';
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=new URL('../../../packages/tabular/',import.meta.url);
await build({entryPoints:[fileURLToPath(new URL('src/index.js',root))],bundle:true,platform:'node',format:'esm',target:'node22',external:['exceljs','jszip','saxes'],outfile:fileURLToPath(new URL('dist/index.js',root))});
await copyFile(new URL('src/index.d.ts',root),new URL('dist/index.d.ts',root));

const require=createRequire(new URL('package.json',root));
const notices=[];
for(const name of ['papaparse','exceljs','jszip','saxes']){const directory=dirname(require.resolve(name+'/package.json'));const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));notices.push(name+' '+pkg.version+'\n'+await readFile(join(directory,name==='jszip'?'LICENSE.markdown':name==='saxes'?'README.md':'LICENSE'),'utf8'));}
await writeFile(new URL('dist/THIRD-PARTY-LICENSES.txt',root),notices.join('\n\n'));
