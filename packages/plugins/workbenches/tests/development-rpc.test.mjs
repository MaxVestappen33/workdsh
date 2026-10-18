import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/development-rpc.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { handleWorkbenchDevelopmentRequest } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const request = payload => new Request('http://localhost/api/workdsh-workbench-development', { method: 'POST', body: JSON.stringify(payload) });
test('Session creation RPC accepts revision guards but cannot accept Session identity or source paths', async () => {
  let calls = 0;
  const service = { ensureSession: async (id, revision) => { calls++; assert.equal(id, 'dev'); assert.equal(revision, 'rev'); return { development: { id } }; } };
  const payload = { developmentId: 'dev', expectedDevelopmentRevision: 'rev' };
  for (const extra of [{ sessionId: 'foreign' }, { cwd: '/tmp/other' }, { owner: {} }, { title: 'override' }])
    assert.equal((await handleWorkbenchDevelopmentRequest(request({ endpoint: 'ensure-session', payload: { ...payload, ...extra } }), service)).status, 400);
  assert.equal(calls, 0);
  assert.equal((await handleWorkbenchDevelopmentRequest(request({ endpoint: 'ensure-session', payload }), service)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await handleWorkbenchDevelopmentRequest(request({ endpoint: 'ensure-session', payload }), {})).status, 503);
});
test('development RPC disallows caller identity, storage and installation target claims', async () => {
  let calls = 0;
  const service = { async list() { calls++; return []; }, async create() { calls++; return {}; }, async advanceRequirements() { calls++; return {}; } };
  const payload = { developmentId: 'dev', workbenchId: 'company.quality', packageName: 'quality-plugin', expectedRequirementsRevision: 'req' };
  for (const extra of [{ owner: {} }, { target: {} }, { source: '/tmp/project' }, { principalId: 'other' }]) {
    const response = await handleWorkbenchDevelopmentRequest(request({ endpoint: 'create', payload: { ...payload, ...extra } }), service);
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await handleWorkbenchDevelopmentRequest(request({ endpoint: 'list', payload: {} }), service)).status, 200);
  assert.equal((await handleWorkbenchDevelopmentRequest(request({ endpoint: 'create', payload }), service)).status, 200);
  assert.equal(calls, 2);
});
test('development failures preserve conflict and missing Creator status and conceal internal paths', async () => {
  for (const [message, status] of [['workbench/development-revision-conflict', 409], ['workbench/development-creator-required', 409], ['workbench/development-access-denied', 403], ['private /home/user/source', 500]]) {
    const service = { async list() { throw new Error(message); } };
    const response = await handleWorkbenchDevelopmentRequest(request({ endpoint: 'list', payload: {} }), service);
    assert.equal(response.status, status);
    const text = await response.text();
    assert.equal(text.includes('/home/user/source'), false);
    if (message === 'workbench/development-creator-required') assert.ok(text.includes(message));
  }
});
test('cancelled streaming request stops waiting for bytes and never calls a development service', async () => {
  const controller = new AbortController();
  let cancelled = false, called = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = handleWorkbenchDevelopmentRequest(new Request('http://localhost/api/workdsh-workbench-development', { method: 'POST', body: stream, duplex: 'half', signal: controller.signal }), { async list() { called = true; } });
  controller.abort();
  assert.equal((await pending).status, 408);
  assert.equal(cancelled, true);
  assert.equal(called, false);
});

test('identity scope is Host resolved and caller identity overrides never reach authority', async () => {
 let calls = 0;
 const service = { async identityScope(signal) { calls++; assert.equal(signal.aborted, false); return { organizationId: 'org', principalId: 'user' }; } };
 for (const payload of [{ principalId: 'other' }, { organizationId: 'other' }, { token: 'secret' }])
  assert.equal((await handleWorkbenchDevelopmentRequest(request({ endpoint: 'identity-scope', payload }), service)).status, 400);
 assert.equal(calls, 0);
 const result = await handleWorkbenchDevelopmentRequest(request({ endpoint: 'identity-scope', payload: {} }), service);
 assert.equal(result.status, 200); assert.deepEqual((await result.json()).value, { organizationId: 'org', principalId: 'user' });
 assert.equal((await handleWorkbenchDevelopmentRequest(request({ endpoint: 'identity-scope', payload: {} }), { async identityScope() { throw new Error('workbench/development-access-denied'); } })).status, 403);
});

test('checkpoint RPC accepts only development identity and refuses arbitrary paths',async()=>{
 let calls=0;const service={sourceCheckpoints:async id=>{calls++;assert.equal(id,'dev');return [{sha256:'a'.repeat(64),fileCount:2,byteLength:20,verified:false}];}};
 for(const extra of [{directory:'/tmp/foreign'},{owner:'other'},{sha256:'b'.repeat(64)}])assert.equal((await handleWorkbenchDevelopmentRequest(request({endpoint:'source-checkpoints',payload:{developmentId:'dev',...extra}}),service)).status,400);
 assert.equal(calls,0);const response=await handleWorkbenchDevelopmentRequest(request({endpoint:'source-checkpoints',payload:{developmentId:'dev'}}),service);assert.equal(response.status,200);assert.equal((await response.json()).value[0].verified,false);assert.equal(calls,1);
 assert.equal((await handleWorkbenchDevelopmentRequest(request({endpoint:'source-checkpoints',payload:{developmentId:'dev'}}),{})).status,503);
});

test('checkpoint verification RPC restricts selection and returns sanitized corruption',async()=>{
 let calls=0;const payload={developmentId:'dev',sha256:'a'.repeat(64)};
 const service={verifySourceCheckpoint:async(id,hash,signal)=>{calls++;assert.equal(id,'dev');assert.equal(hash,payload.sha256);assert.equal(signal.aborted,false);return {sha256:hash,fileCount:1,byteLength:8,verified:true};}};
 for(const invalid of [{...payload,directory:'/tmp/foreign'},{...payload,owner:'foreign'},{...payload,sha256:'../outside'}])assert.equal((await handleWorkbenchDevelopmentRequest(request({endpoint:'verify-source-checkpoint',payload:invalid}),service)).status,400);
 assert.equal(calls,0);
 const response=await handleWorkbenchDevelopmentRequest(request({endpoint:'verify-source-checkpoint',payload}),service);assert.equal(response.status,200);assert.equal((await response.json()).value.verified,true);assert.equal(calls,1);
 assert.equal((await handleWorkbenchDevelopmentRequest(request({endpoint:'verify-source-checkpoint',payload}),{})).status,503);
 const corrupt=await handleWorkbenchDevelopmentRequest(request({endpoint:'verify-source-checkpoint',payload}),{verifySourceCheckpoint:async()=>{throw new Error('workbench/checkpoint-corrupt');}});assert.equal(corrupt.status,409);assert.equal((await corrupt.json()).error.code,'workbench/checkpoint-corrupt');
});

test('recovery preparation only accepts development revision and selected checkpoint',async()=>{
 const payload={developmentId:'dev',expectedDevelopmentRevision:'rev',sha256:'a'.repeat(64)};let calls=0;
 const service={prepareSourceRecovery:async(id,revision,hash)=>{calls++;assert.equal(id,'dev');assert.equal(revision,'rev');return {journalId:'journal',beforeSha256:hash,targetSha256:hash,state:'prepared'};}};
 for(const invalid of [{...payload,directory:'/foreign'},{...payload,owner:'other'},{...payload,sessionId:'other'},{...payload,sha256:'../other'}])assert.equal((await handleWorkbenchDevelopmentRequest(request({endpoint:'prepare-source-recovery',payload:invalid}),service)).status,400);
 assert.equal(calls,0);assert.equal((await handleWorkbenchDevelopmentRequest(request({endpoint:'prepare-source-recovery',payload}),service)).status,200);assert.equal(calls,1);
 assert.equal((await handleWorkbenchDevelopmentRequest(request({endpoint:'prepare-source-recovery',payload}),{})).status,503);
 for(const code of ['workbench/source-recovery-busy','workbench/source-revision-conflict'])assert.equal((await handleWorkbenchDevelopmentRequest(request({endpoint:'prepare-source-recovery',payload}),{prepareSourceRecovery:async()=>{throw Error(code);}})).status,409);
});

test('continuation RPC retains actionable target and source codes without leaking paths',async()=>{
 for(const code of ['workbench/installation-target-changed','workbench/development-source-unavailable','workbench/source-identity-mismatch','workbench/source-directory-outside']){
  const response=await handleWorkbenchDevelopmentRequest(request({endpoint:'ensure-session',payload:{developmentId:'dev',expectedDevelopmentRevision:'rev'}}),{ensureSession:async()=>{throw Error(code);}});
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,code);
 }
});
