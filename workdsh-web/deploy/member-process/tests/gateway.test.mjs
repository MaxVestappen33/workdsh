import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createServer as createTlsServer,globalAgent} from 'node:https';
import {mkdtemp,readFile,writeFile,cp,rm,mkdir,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const listen=s=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});
const close=s=>s?new Promise(resolve=>{s.closeAllConnections();s.close(resolve);}):Promise.resolve();

test('native member ingress rejects unready/cross-origin/admin requests and separates member runtime cookies',async()=>{
 const admin=process.env.WORKDSH_ADMIN_SOURCE ? resolve(process.env.WORKDSH_ADMIN_SOURCE) : fileURLToPath(new URL('../../../../workdsh-admin/',import.meta.url));
 const fence=join(admin,'deploy/docker/account-storage-fence.mjs');
 // Resolve the shared backend dependency before any server starts so a missing checkout fails promptly.
 await access(fence);
 const root=await mkdtemp(join(tmpdir(),'member-ingress-test-'));
 let backend,gateway;const upstreams=[],users=[],events=[];
 const oldCa=globalAgent.options.ca;
 try {
 const key=join(root,'key.pem'),cert=join(root,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const certificate=await readFile(cert);globalAgent.options.ca=certificate;
 const tokens={a:'member-login-a-1234567890',b:'member-login-b-1234567890',pending:'member-login-pending-1234567890'};
 backend=createTlsServer({key:await readFile(key),cert:certificate},(req,res)=>{
  const name=Object.keys(tokens).find(k=>req.headers.cookie==='workdsh-admin-session='+tokens[k]);
  res.setHeader('content-type','application/json');
  if(!name)return res.writeHead(401).end('{}');
  res.end(JSON.stringify({id:name,organizationId:'org',mustChangePassword:name==='pending'}));
 });await listen(backend);
 for(const name of ['a','b']){
  const s=createServer((req,res)=>{
   if(req.url.startsWith('/?token=')){res.setHeader('set-cookie','official-fixture='+name+'; Path=/');return res.end();}
   events.push({name,cookie:req.headers.cookie,authorization:req.headers.authorization});res.end(name);
  });await listen(s);upstreams.push(s);
  const home=join(root,name);await mkdir(home);await writeFile(join(home,'login'),'[]',{mode:0o600});
  users.push({id:name,org:'org',name,root:home,uid:process.getuid(),gid:process.getgid(),port:s.address().port,token:'private-bootstrap-fixture'});
 }
 process.env.WORKDSH_ADMIN_URL='https://127.0.0.1:'+backend.address().port;
 process.env.WORKDSH_USER_ORIGIN='http://127.0.0.1:19459';
 process.env.WORKDSH_ADMIN_WEB_ORIGIN='http://127.0.0.1:19340';process.env.WORKDSH_PORT='0';
 await cp(new URL('../gateway.mjs',import.meta.url),join(root,'gateway.mjs'));
 await cp(fence,join(root,'account-storage-fence.mjs'));
 const {startGateway}=await import(pathToFileURL(join(root,'gateway.mjs')));
 gateway=await startGateway(users,{resolveMember:async actor=>{assert.notEqual(actor.id,'pending');return users.find(u=>u.id===actor.id);},ensure:async()=>{},logout:async()=>{}});
 const call=(name,{path='/api/native-fixture',method='GET',origin,host='127.0.0.1:19459',site}={})=>new Promise((resolve,reject)=>{
  const headers={host,cookie:'workdsh-member-session-19459='+tokens[name],authorization:'Bearer attacker-supplied'};
  if(origin)headers.origin=origin;if(site)headers['sec-fetch-site']=site;
  const req=request({host:'127.0.0.1',port:gateway.address().port,path,method,headers},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();
 });
  assert.equal((await call('pending')).status,401);
  for(const path of ['https://attacker.example/api/auth/me','//attacker.example/api/auth/me'])assert.equal((await call('a',{path})).status,400);
  assert.equal((await call('a',{host:'attacker.example'})).status,403);
  assert.equal((await call('a',{site:'cross-site'})).status,403);
  assert.equal((await call('a',{method:'POST',origin:'http://attacker.example'})).status,403);
  for(const path of ['/api/admin/members','/api/internal/member-sessions','/?token=foreign'])assert.equal((await call('a',{path})).status,403);
  assert.equal((await call('a')).body,'a');assert.equal((await call('b')).body,'b');
  assert.deepEqual(events.map(e=>[e.name,e.cookie,e.authorization]),[['a','official-fixture=a',undefined],['b','official-fixture=b',undefined]]);
  const stored=JSON.parse(await readFile(join(root,'a/login'),'utf8'));
  assert.deepEqual(stored,['workdsh-admin-session='+tokens.a]);
  assert.equal(JSON.stringify(stored).includes(tokens.b),false);
 }finally{
  await close(gateway);for(const s of upstreams)await close(s);await close(backend);globalAgent.options.ca=oldCa;await rm(root,{recursive:true,force:true});
 }
});
