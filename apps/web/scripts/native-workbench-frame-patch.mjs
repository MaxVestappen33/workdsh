import {readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const spec=JSON.parse(await readFile(new URL('./native-workbench-frame-patch.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
export function patchNativeWorkbenchFrame(source){
 const digest=hash(source);if(digest===spec.patchedSha256)return source;
 if(digest!==spec.originalSha256)throw Error('Native workbench frame: unsupported runtime bytes; refusing to patch.');
 let output=source;
 for(const [before,after] of spec.replacements){if(output.split(before).length!==2)throw Error('Native frame patch anchor mismatch');output=output.replace(before,after);}
 if(hash(output)!==spec.patchedSha256)throw Error('Native frame patch result mismatch');return output;
}
// Replace this installation's directory entry, never mutate a pnpm hardlink
// in place (which could otherwise change a different Profile or the store).
async function replaceRuntimeFile(target,expected,next){
 const temporary=`${target}.workdsh-frame-${randomUUID()}`;
 const mode=(await stat(target)).mode&0o777;
 try{
  await writeFile(temporary,next,{flag:'wx',mode});
  if(hash(await readFile(target,'utf8'))!==hash(expected))throw Error('Native frame target changed during update');
  await rename(temporary,target);
 }finally{await rm(temporary,{force:true});}
}
export async function ensureNativeWorkbenchFrame(profile,{rollback=false}={}){
 const require=createRequire(join(profile,'package.json'));
 const path=require.resolve(`${spec.package}/package.json`),manifest=JSON.parse(await readFile(path,'utf8'));
 if(manifest.version!==spec.version)throw Error('Native workbench frame: runtime version mismatch');
 const target=join(dirname(path),spec.file),source=await readFile(target,'utf8');
 if(rollback){if(hash(source)===spec.originalSha256)return;if(hash(source)!==spec.patchedSha256)throw Error('Cannot roll back unknown runtime');let original=source;for(const [before,after] of [...spec.replacements].reverse())original=original.replace(after,before);if(hash(original)!==spec.originalSha256)throw Error('Rollback mismatch');await replaceRuntimeFile(target,source,original);return;}
 const patched=patchNativeWorkbenchFrame(source);
 if(patched!==source)await replaceRuntimeFile(target,source,patched);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){if(!process.argv[2])throw Error('Profile path required');await ensureNativeWorkbenchFrame(process.argv[2],{rollback:process.argv.includes('--rollback')});}
