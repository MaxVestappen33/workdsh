import {createHash,randomUUID} from 'node:crypto';
import {isAbsolute,basename,join} from 'node:path';
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export const MAX_INPUT_BYTES=8*1024*1024;
export function encodeOperationInput(input){
 const encoded=JSON.stringify(input);
 if(!encoded||Buffer.byteLength(encoded)>MAX_INPUT_BYTES)throw Error('COMPUTE_INPUT_TRANSPORT_LIMIT');
 return encoded;
}
/** A payload larger than the command cap travels through the official write
 * tool. The shell returns its own workspace temporary directory; no private
 * Host path, model path or direct Host filesystem write is used here. */
export async function stageOperationInput(dispatch,parse,python,encoded){
 if(Buffer.byteLength(encoded)<=32768)return {argument:Buffer.from(encoded).toString('base64'),cleanup:null};
 const prefix='.workdsh-compute-input-'+randomUUID()+'-';
 const create=`import json,os,tempfile;print(json.dumps({'directory':tempfile.mkdtemp(prefix=${JSON.stringify(prefix)},dir=os.getcwd())}))`;
 const result=parse(await dispatch('bash',{command:`${quote(python)} -I -c ${quote(create)}`,description:'准备当前工作区的专业计算临时输入',timeoutMs:10000},'input-create'),'INPUT');
 if(typeof result?.directory!=='string'||!isAbsolute(result.directory)||!basename(result.directory).startsWith(prefix))throw Error('HOST_COMPUTE_INPUT_INVALID_OUTPUT');
 const path=join(result.directory,'payload.json');
 const cleanup={directory:result.directory,path};
 try{await dispatch('write',{file_path:path,content:encoded},'input-write');}
 catch(error){error.computeInputCleanup=cleanup;throw error;}
 return {argument:`--payload-file ${quote(path)} ${quote(createHash('sha256').update(encoded).digest('hex'))}`,cleanup};
}
export function cleanupOperationInputCommand(python,cleanup){
 const script="import os,pathlib,sys;p=pathlib.Path(sys.argv[1]);d=p.parent;assert p.name=='payload.json' and d.name.startswith('.workdsh-compute-input-') and not d.is_symlink();p.unlink(missing_ok=True);d.rmdir()";
 return `${quote(python)} -I -c ${quote(script)} ${quote(cleanup.path)}`;
}
