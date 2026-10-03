import {renderMemberPatch} from './profile.mjs';
import {memberEnvironment} from './environment.mjs';
import {startSessionBridge} from './session-bridge.mjs';
import {MemberProcessSupervisor} from '/opt/workdsh/profiles/enterprise/node_modules/workdsh-provider-identity-enterprise/dist/process-supervisor.js';
import {mkdir,writeFile,chmod,chown,readFile,rename} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {startGateway} from './gateway.mjs';
const modules='/opt/workdsh/profiles/enterprise/node_modules';
const source=JSON.parse(await readFile('/opt/workdsh/profiles/enterprise/package.json','utf8'));
const manifest=JSON.parse(await readFile('/server/workdsh-features.json','utf8'));
const bundles=[...manifest.officialBundles,'workdsh-bundle','workdsh-provider-identity-enterprise','workdsh-plugin-access','workdsh-plugin-audit',...manifest.features.map(f=>f.name)];
const users=[];
await mkdir('/state',{recursive:true});await chmod('/state',0o711);
let registry;try{registry=JSON.parse(await readFile('/state/member-registry.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;registry=[];}
if(!Array.isArray(registry))throw Error('Invalid member registry');
let registryTail=Promise.resolve();
async function resolveMember(actor){
 if(!actor?.id||!actor.organizationId)throw Error('Verified member required');
 const next=registryTail.catch(()=>{}).then(async()=>{
 const name=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.id])).digest('hex');
 let u=users.find(x=>x.name===name);if(u)return u;
 let record=registry.find(x=>x.name===name);
 if(record&&(record.id!==actor.id||record.org!==actor.organizationId))throw Error('Registry mismatch');
 if(!record){const passwd=await readFile('/etc/passwd','utf8');let uid=22000;while(registry.some(x=>x.uid===uid)||passwd.split('\n').some(x=>Number(x.split(':')[2])===uid))uid++;const port=22000+registry.length;if(port>65000)throw Error('No member port available');record={name,id:actor.id,org:actor.organizationId,uid,port};registry.push(record);await writeFile('/state/member-registry.next',JSON.stringify(registry),{mode:0o600});await rename('/state/member-registry.next','/state/member-registry.json');}
 const account='wd-'+record.uid;
 const passwd=await readFile('/etc/passwd','utf8');if(!passwd.split('\n').some(x=>x.split(':')[0]===account))await writeFile('/etc/passwd',passwd+`${account}:x:${record.uid}:${record.uid}::/state/${name}/home:/usr/sbin/nologin\n`);
 const group=await readFile('/etc/group','utf8');if(!group.split('\n').some(x=>x.split(':')[0]===account))await writeFile('/etc/group',group+`${account}:x:${record.uid}:\n`);
 u={...record,root:'/state/'+name};users.push(u);return u;
 });registryTail=next;return next;
}
const children=[];
async function snapshot(){await writeFile('/state/lifecycle.json',JSON.stringify(users.map(u=>({name:u.name,pid:u.child?.pid??null,generation:u.generation??0}))));}
await mkdir('/state',{recursive:true});for(const u of users)u.root='/state/'+u.name;
async function start(user,credential){
 const root='/state/'+user.name;user.root=root;await mkdir(root,{recursive:true});await chmod(root,0o700);await chown(root,user.uid,user.uid);
 for(const dir of ['home','agents','workspace','dsh','dsh/profiles','dsh/profiles/web']){const p=root+'/'+dir;await mkdir(p,{recursive:true});await chown(p,user.uid,user.uid);await chmod(p,0o700);}
 const p=root+'/dsh/profiles/web';
 const {symlink}=await import('node:fs/promises');await symlink(modules,p+'/node_modules').catch(e=>{if(e.code!=='EEXIST')throw e;});
 await writeFile(p+'/package.json',JSON.stringify({...source,dsh:{profile:{bundles}}}));await writeFile(p+'/cordis.yml','[]\n',{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 await writeFile(p+'/cordis.patch.yml', renderMemberPatch(user, {
   backendUrl: process.env.WORKDSH_ADMIN_URL,
 }));
 await writeFile(root+'/login',JSON.stringify([credential]),{mode:0o600});await chown(root+'/login',user.uid,user.uid);
 for(const file of ['package.json','cordis.yml','cordis.patch.yml'])await chown(p+'/'+file,user.uid,user.uid);

 if(!user.guarded){execFileSync('/usr/sbin/iptables',['-A','OUTPUT','-p','tcp','--dport',String(user.port),'-m','owner','--uid-owner','0','-j','ACCEPT']);
 execFileSync('/usr/sbin/iptables',['-A','OUTPUT','-p','tcp','--dport',String(user.port),'-m','owner','--uid-owner',String(user.uid),'-j','ACCEPT']);
 execFileSync('/usr/sbin/iptables',['-A','OUTPUT','-p','tcp','--dport',String(user.port),'-j','REJECT']);user.guarded=true;}
 if(process.env.WORKDSH_SERVICE_KEY_FILE){
  user.bridgePort=32000+registry.findIndex(r=>r.name===user.name);
  if(!user.bridge){
   for(const uid of ['0',String(user.uid)])execFileSync('/usr/sbin/iptables',['-A','OUTPUT','-p','tcp','--dport',String(user.bridgePort),'-m','owner','--uid-owner',uid,'-j','ACCEPT']);
   execFileSync('/usr/sbin/iptables',['-A','OUTPUT','-p','tcp','--dport',String(user.bridgePort),'-j','REJECT']);
   user.bridge=await startSessionBridge(user,{backendUrl:process.env.WORKDSH_ADMIN_URL,serviceKey:(await readFile(process.env.WORKDSH_SERVICE_KEY_FILE,'utf8')).trim()});
  }
 }
 await writeFile(p+'/cordis.patch.yml', renderMemberPatch(user, {
   backendUrl: process.env.WORKDSH_ADMIN_URL,
   bridgeUrl: user.bridge ? `http://127.0.0.1:${user.bridgePort}` : undefined,
 }));
 await chown(p+'/cordis.patch.yml',user.uid,user.uid);
 const env=memberEnvironment(user,{certificatePath:process.env.NODE_EXTRA_CA_CERTS});
 user.error='';await writeFile(user.root+'/diagnostic.log','',{mode:0o600});
 const child=spawn('setpriv',['--reuid',String(user.uid),'--regid',String(user.uid),'--clear-groups','--inh-caps=-all','--bounding-set=-all','--no-new-privs',process.execPath,modules+'/@deepseek-ai/dsh/lib/bin.js','--profile','web','--host','127.0.0.1','--port',String(user.port),'--no-open'],{cwd:root+'/workspace',env,stdio:['ignore','pipe','pipe']});children.push(child);user.child=child;user.generation=(user.generation??0)+1;await snapshot();
 child.on('exit',()=>{if(user.child===child){user.child=undefined;user.token=undefined;user.runtimeCookies=undefined;snapshot().catch(()=>{});}});
 user.ready=new Promise((resolve,reject)=>{let output='';child.stdout.on('data',b=>{output=(output+b).slice(-16000);const match=output.match(/\?token=([\w-]+)/);if(match){user.token=match[1];resolve();}});child.stderr.on('data',b=>{user.error=((user.error??'')+b).slice(-16000);writeFile(user.root+'/diagnostic.log',user.error.replace(/token=[\w-]+/g,'token=REDACTED')).catch(()=>{});});child.on('exit',()=>reject(Error('Member runtime startup failed')));});
 let timer;try{await Promise.race([user.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Member startup timeout')),60000);})]);}catch(e){child.kill('SIGTERM');throw e;}finally{clearTimeout(timer);}return user;
}
const supervisor=new MemberProcessSupervisor({async start(member,credential){const user=users.find(u=>u.id===member.principalId&&member.organizationId===u.org);if(!user)throw Error('Unknown admitted member');await start(user,credential);user.alive=()=>!!user.child&&user.child.exitCode===null&&user.child.signalCode===null;user.stop=async()=>{const child=user.child;if(!child)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});};return user;}});
const ensure=(user,credential)=>supervisor.login({principalId:user.id,organizationId:user.org},credential);
const logout=(user,credential)=>supervisor.logout({principalId:user.id,organizationId:user.org},credential);
await snapshot();await startGateway(users,{ensure,logout,resolveMember});console.log('READY member server; no prestarted member processes');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(),2000).unref();});
