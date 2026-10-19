import {readFileSync,existsSync} from 'node:fs';
import {join,dirname,delimiter} from 'node:path';

/** Preview installation and native plugin_manager must resolve the same pnpm.
 * Scope PATH to this child process; never alter global package-manager settings. */
export function previewProcessEnvironment(root, environment=process.env, nodeExecutable=process.execPath){
 const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 const installed=JSON.parse(readFileSync(join(root,'node_modules/pnpm/package.json'),'utf8'));
 const binaryDirectory=join(root,'node_modules/.bin');
 const command=join(binaryDirectory,process.platform==='win32'?'pnpm.cmd':'pnpm');
 if(manifest.packageManager!==`pnpm@${installed.version}`||!existsSync(command))throw Error('Preview pnpm does not match packageManager; restore workspace dependencies before starting.');
 return {...environment,PATH:[binaryDirectory,dirname(nodeExecutable),environment.PATH??''].join(delimiter)};
}
