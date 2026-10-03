import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {memberEnvironment} from '../environment.mjs';

test('actual member launcher uses the same minimal environment with no root credentials or inherited execution options',async()=>{
  const poison={WORKDSH_SERVICE_KEY:'secret',WORKDSH_ADMIN_PASSWORD:'secret',NODE_OPTIONS:'--require /attacker.js',HTTP_PROXY:'http://attacker',WORKDSH_RUNTIME_TOKEN:'obsolete'};
  const previous=Object.fromEntries(Object.keys(poison).map(k=>[k,process.env[k]]));
  Object.assign(process.env,poison);
  try {
    assert.deepEqual(memberEnvironment({uid:22001,root:'/state/member-a',...poison},{nodeExecutable:'/usr/local/bin/node',certificatePath:'/server/public-ca.pem'}),{
      NODE_EXTRA_CA_CERTS:'/server/public-ca.pem',PATH:'/usr/local/bin:/usr/local/bin:/usr/bin:/bin',HOME:'/state/member-a/home',USER:'wd-22001',LANG:'C.UTF-8',DSH_HOME:'/state/member-a/dsh',DSH_AGENTS_HOME:'/state/member-a/agents',
    });
    assert.ok(!Object.keys(memberEnvironment({uid:22002,root:'/state/member-b'})).some(k=>k in poison));
    const source=await readFile(new URL('../start.mjs',import.meta.url),'utf8');
    assert.match(source,/const env=memberEnvironment\(user,/);
    assert.match(source,/cwd:root\+'\/workspace',env,stdio/);
    for(const [uid,root] of [[0,'/state/a'],[-1,'/state/a'],[22001,'relative']])assert.throws(()=>memberEnvironment({uid,root}),/Trusted/);
  } finally {
    for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
