/** Verify a Host-registered offline Python bundle. No discovery, spawn or pip here.
 * The registration directory/digest must come from trusted installed plugin data,
 * never from a client request, model argument or uploaded document.
 */
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const validDigest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=code=>{throw Error(code);};

export async function verifyLockedPackage(registration,target,signal){
 signal.throwIfAborted();
 if(!exact(registration,['directory','manifestSha256'])||typeof registration.directory!=='string'||!isAbsolute(registration.directory)||!validDigest(registration.manifestSha256))fail('INVALID_REGISTRATION');
 const requested=resolve(registration.directory);
 if((await lstat(requested)).isSymbolicLink()||!(await lstat(requested)).isDirectory())fail('UNTRUSTED_PACKAGE_DIRECTORY');
 // macOS /var and /tmp have system-owned canonical aliases. Reject a symlink
 // bundle itself while resolving trusted registration ancestors once.
 const root=await realpath(requested);
 const manifestPath=join(root,'compute-package.json');
 if(!(await lstat(manifestPath)).isFile()||(await lstat(manifestPath)).isSymbolicLink())fail('INVALID_MANIFEST_FILE');
 const bytes=await readFile(manifestPath);
 if(bytes.length>65536||sha(bytes)!==registration.manifestSha256)fail('MANIFEST_DIGEST_MISMATCH');
 const m=JSON.parse(bytes.toString('utf8'));
 const keys=['contractVersion','id','version','platform','architecture','python','minimumSystemVersion','module','operations','artifacts'];
 if(m.contractVersion===2)keys.push('hostDependencies');
 if(!exact(m,keys)||![1,2].includes(m.contractVersion)||!(/^[a-z][a-z0-9-]{0,63}$/.test(m.id))||!(/^[0-9][a-zA-Z0-9.+-]{0,63}$/.test(m.version))||!(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(m.module))||!(/^[0-9]+\.[0-9]+$/.test(m.python))||!(/^[0-9]+\.[0-9]+$/.test(m.minimumSystemVersion)))fail('INVALID_MANIFEST');
 if(m.platform!==target.platform||m.architecture!==target.architecture||m.python!==target.python)fail('UNSUPPORTED_COMPUTE_TARGET');
 if(typeof target.systemVersion!=='string'||!/^\d+\.\d+(\.\d+)?$/.test(target.systemVersion))fail('INVALID_COMPUTE_TARGET');
 const version=v=>v.split('.').map(Number);
 const minimum=version(m.minimumSystemVersion),current=version(target.systemVersion??'0.0');
 if(current[0]<minimum[0]||current[0]===minimum[0]&&current[1]<minimum[1])fail('UNSUPPORTED_SYSTEM_VERSION');
 if(!Array.isArray(m.operations)||!m.operations.length||m.operations.length>16||new Set(m.operations).size!==m.operations.length||!m.operations.every(v=>typeof v==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(v)))fail('INVALID_OPERATIONS');
 if(!Array.isArray(m.artifacts)||!m.artifacts.length||m.artifacts.length>32)fail('INVALID_ARTIFACTS');
 const names=new Set(),files=new Set();let total=0;
 for(const a of m.artifacts){
  signal.throwIfAborted();
  if(!exact(a,['name','version','file','sha256','bytes'])||typeof a.name!=='string'||!(/^[a-z][a-z0-9-]{0,63}$/.test(a.name))||typeof a.version!=='string'||!(/^[0-9][a-zA-Z0-9.+-]{0,63}$/.test(a.version))||typeof a.file!=='string'||!(/^[a-zA-Z0-9_.+-]+\.whl$/.test(a.file))||!validDigest(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>100*1024*1024||names.has(a.name)||files.has(a.file))fail('INVALID_ARTIFACT');
  names.add(a.name);files.add(a.file);total+=a.bytes;if(total>512*1024*1024)fail('PACKAGE_SIZE_LIMIT');
  const path=join(root,a.file),stat=await lstat(path);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==a.bytes)fail('ARTIFACT_FILE_MISMATCH');
  if(sha(await readFile(path))!==a.sha256)fail('ARTIFACT_DIGEST_MISMATCH');
 }
 if(m.contractVersion===2){
  if(!Array.isArray(m.hostDependencies)||m.hostDependencies.length!==1||!exact(m.hostDependencies[0],['name','version'])||m.hostDependencies[0].name!=='numpy'||m.hostDependencies[0].version!=='2.3.5'||names.has('numpy')||m.artifacts.some(a=>!a.file.endsWith('-py3-none-any.whl')))fail('INVALID_HOST_DEPENDENCIES');
 }
 const requirements=m.artifacts.map(a=>`${a.name}==${a.version} --hash=sha256:${a.sha256}\n`).join('');
 // This lock is derived from the verified manifest; extra/modified requirements fail closed.
 const lockPath=join(root,'requirements.lock'),lockStat=await lstat(lockPath);
 if(lockStat.isSymbolicLink()||!lockStat.isFile()||await readFile(lockPath,'utf8')!==requirements)fail('DEPENDENCY_LOCK_MISMATCH');
 signal.throwIfAborted();
 return Object.freeze({manifest:structuredClone(m),directory:root,requirements,
  manifestSha256:registration.manifestSha256,dependencyLockSha256:sha(Buffer.from(requirements))});
}
