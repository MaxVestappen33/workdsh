import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';
import {Context} from '@deepseek-ai/cordis';import Identity from '../dist/process.js';
test('process identity: real server response bound to member; no local fallback; protected login',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'process-identity-'));const file=join(dir,'auth');let enabled=true;let id='a';
 const server=createServer((req,res)=>{if(!enabled||req.headers.cookie!=='workdsh-admin-session=abcdefghijklmnop'){res.writeHead(401);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({id,organizationId:'org',role:'MEMBER',mustChangePassword:false}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const ctx=new Context();const identity=new Identity(ctx,{backendUrl:'http://127.0.0.1:'+server.address().port,authFile:file,principalId:'a',organizationId:'org'});
 try{await writeFile(file,'workdsh-admin-session=abcdefghijklmnop',{mode:0o600});assert.equal((await identity.resolve()).principalId,'a');assert.equal(identity.profile().organization.kind,'team');assert.equal(identity.profile().membership.role,'member');
 await writeFile(file,JSON.stringify(['workdsh-admin-session=expiredexpiredexpired','workdsh-admin-session=abcdefghijklmnop']));assert.equal((await identity.resolve()).principalId,'a');await writeFile(file,JSON.stringify([]));await assert.rejects(identity.resolve(),/authentication/);assert.throws(()=>identity.profile(),/authentication/);await writeFile(file,'workdsh-admin-session=abcdefghijklmnop');
 id='b';await assert.rejects(identity.resolve(),/mismatch/);id='a';enabled=false;await assert.rejects(identity.resolve(),/authentication/);enabled=true;
 await chmod(file,0o644);await assert.rejects(identity.resolve(),/Protected/);await chmod(file,0o600);await writeFile(file,'');await assert.rejects(identity.resolve());
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
