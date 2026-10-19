import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const sdkRequire = createRequire(new URL('../package.json', import.meta.url));
const eventsPath = new URL('./types/client/contract/events.js', pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-api-session-controller/client')));
// Only the SDK's notification helper is needed; unreferenced store engines are
// dev-only dependencies of its published package and are removed by tree shaking.
const eventBuilt = await require('esbuild').build({ entryPoints: [fileURLToPath(eventsPath)], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'unused-store-engines', setup(builder) { builder.onResolve({ filter: /^(zustand(?:\/.*)?|immer)$/ }, args => ({ path: args.path, external: true, sideEffects: false })); } }] });
const { MutableSessionEventSource } = await import(`data:text/javascript;base64,${Buffer.from(eventBuilt.outputFiles[0].text).toString('base64')}`);
const built = await require('esbuild').build({ entryPoints: [fileURLToPath(new URL('../src/client/native-conversation-owner.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { NativeWorkbenchConversationOwner: Owner } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

// Only the Session lease/input ports are fixtures. Event publication uses the
// installed official SDK; this test does not claim a browser Agent execution.
function fixture({ draft = '', attachmentIds = [], occurrences = [], phase = 'plain', readyError, submitError, initializedOccurrences, blocked = false } = {}) {
  let state = { draft, attachmentIds, occurrences, phase }, resolve;
  const calls = [], eventSource = new MutableSessionEventSource();
  const binding = { sessionId: 'session-1', ctx: {}, eventSource };
  const ready = readyError ? Promise.reject(readyError) : blocked ? new Promise(done => { resolve = done; }) : Promise.resolve(binding);
  const native = {
    sessions: { retain(id, options) { calls.push(['retain', id, options.source]); return { sessionId: id, ready, release() { calls.push(['release']); } }; } },
    conversation: { input: {
      for(ctx) { assert.equal(ctx, binding.ctx); return { state: { getSnapshot: () => state }, submit(mode,source) {calls.push(['submit',mode,source]);if(submitError)throw submitError;state={...state,draft:''};} }; },
      requestDraftInitialization(actual, options) { assert.equal(actual, binding); calls.push(['initialize', options]); state = { ...state, draft: options.prompt,occurrences:initializedOccurrences??state.occurrences }; return 'applied'; },
    } },
  };
  return { native, calls, eventSource, binding, resolveReady: () => resolve(binding), state: () => state };
}
const request = { id: 'analysis-1', instruction: '分析本次检验数据' };
function result(seq, callId = `call-${seq}`) { return { type: 'event', event: { seq, time: 1, type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: callId, content: [] } } } }; }

test('native draft initializes once without navigation/submission; request id cannot acquire different content', async () => {
  const f = fixture(), owner = new Owner(f.native, 'session-1', 'tenant:user');
  await Promise.all([owner.prepareDraft(request), owner.prepareDraft(request)]);
  assert.deepEqual(f.calls, [['retain', 'session-1', 'workdshWorkbenchConversation'], ['initialize', { prompt: request.instruction, clearPreviousDraft: false }]]);
  assert.equal(f.state().draft, request.instruction);
  await assert.rejects(owner.prepareDraft({ ...request, instruction: '另一项需求' }), /request-mismatch/);
  owner.dispose(); owner.dispose();
  assert.equal(f.calls.filter(call => call[0] === 'release').length, 1);
});

test('preserves native text, attachments, references and pending submission', async () => {
  for (const input of [{ draft: '用户正在输入' }, { attachmentIds: ['file-1'] }, { occurrences: [{ id: 'reference-1' }] }, { phase: 'submitting' }]) {
    const f = fixture(input), owner = new Owner(f.native, 'session-1', 'tenant:user');
    await assert.rejects(owner.prepareDraft(request), /draft-not-empty|input-busy/);
    assert.equal(f.calls.some(call => call[0] === 'initialize'), false);
    assert.equal(f.state().draft, input.draft ?? '');
    owner.dispose();
  }
});

test('mount owns one composer seat and cancels deferred draft/lease on identity or page disposal', async () => {
  const f = fixture({ blocked: true }), page = new AbortController();
  const owner = new Owner(f.native, 'session-1', 'tenant:user', { signal: page.signal });
  assert.throws(() => new Owner(f.native, 'session-1', 'other:user'), /already-mounted/);
  const queued = owner.prepareDraft(request);
  page.abort(); f.resolveReady();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(f.calls.some(call => call[0] === 'initialize'), false);
  assert.equal(f.calls.filter(call => call[0] === 'release').length, 1);
  const replacement = new Owner(f.native, 'session-1', 'other:user'); await replacement.ready; replacement.dispose();
});

test('failed official Session resolution releases retained seat for a retry', async () => {
  const f = fixture({ readyError: new Error('session-unavailable') });
  const owner = new Owner(f.native, 'session-1', 'tenant:user');
  await assert.rejects(owner.ready, /session-unavailable/);
  assert.deepEqual(f.calls.at(-1), ['release']);
  const replacement = new Owner(f.native, 'session-1', 'tenant:user');
  await assert.rejects(replacement.ready, /session-unavailable/);
});

test('official durable tool results refresh once, excluding historical pages and transient frames', async () => {
  const f = fixture(), seen = [];
  f.eventSource.replace([result(8), { type: 'transient', event: { seq: 999, type: 'assistant/live-chunk', data: {} } }], true);
  const owner = new Owner(f.native, 'session-1', 'tenant:user', { onToolSettled: event => seen.push(event) });
  await owner.ready;
  assert.equal(seen.length, 0);
  f.eventSource.prepend([result(2)], false);
  f.eventSource.append({ type: 'transient', event: { seq: 1000, type: 'assistant/live-chunk', data: {} } });
  f.eventSource.append(result(9, 'actual-tool-call'));
  f.eventSource.replace([result(8), result(9), result(10)], false);
  assert.deepEqual(seen.map(event => [event.sessionId, event.sequence, event.callId]), [['session-1', 9, 'actual-tool-call'], ['session-1', 10, 'call-10']]);
  const signal = seen[0].signal; owner.dispose();
  assert.equal(signal.aborted, true);
  f.eventSource.append(result(11));
  assert.equal(seen.length, 2);
});

const flowBuilt = await require('esbuild').build({ stdin: { contents: "export {prepareWorkbenchResume} from './resume-development.ts'; export {createWorkbenchDevelopmentInstruction} from './development-instruction.ts';", resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)) }, bundle: true, platform: 'node', format: 'esm', write: false });
const {prepareWorkbenchResume,createWorkbenchDevelopmentInstruction}=await import(`data:text/javascript;base64,${Buffer.from(flowBuilt.outputFiles[0].text).toString('base64')}`);
test('continue submits the pending confirmation instruction through the native owner without replacement or a second click',async()=>{
 const ownerIdentity={organizationId:'org',ownerPrincipalId:'member'};
 const saved={id:'req-1',developmentId:'dev-1',owner:ownerIdentity,requirements:{title:'物品管理',scenario:'仓库进货',users:'仓管',dataSources:'手动录入',workflow:'建物品后登记进货',firstIteration:'物品与进货',acceptance:'进货后库存增加'}};
 const entry={development:{id:'dev-1',revision:'rev-1',requirementsRevision:saved.id,owner:ownerIdentity,workbenchId:'company.inventory',packageName:'inventory-plugin',session:{hostId:'host',sessionId:'session-1'}}};
 const pending=createWorkbenchDevelopmentInstruction(saved,entry.development);
 const resumed=await prepareWorkbenchResume({async list(){return[entry]},async ensureSession(){return entry}},{async history(){return[saved]}},'dev-1');
 const f=fixture({draft:pending}),owner=new Owner(f.native,'session-1','tenant:user');
 await owner.prepareDraft({id:'development-start:dev-1:req-1',instruction:resumed.instruction,submit:true});
 assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);
 assert.equal(f.calls.some(c=>c[0]==='initialize'),false,'preserve the pending native draft');
 owner.dispose();
});

// Explicit starts use the official submit port; no model execution in tests.
test('explicit start submits once and cannot replay after bridge remount or content change',async()=>{
 const f=fixture(),r={id:'opening-1',instruction:'梳理需求',submit:true};let owner=new Owner(f.native,'session-1','tenant:user');
 await Promise.all([owner.prepareDraft(r),owner.prepareDraft(r)]);assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);assert.equal(f.state().draft,'');
 owner.dispose();owner=new Owner(f.native,'session-1','tenant:user');await owner.prepareDraft(r);assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);
 await assert.rejects(owner.prepareDraft({...r,instruction:'另一项任务'}),/request-mismatch/);owner.dispose();
});
test('explicit start preserves unrelated native drafts and sends an identical prepared opening only after the start action',async()=>{
 const blocked=fixture({draft:'用户草稿'}),a=new Owner(blocked.native,'session-1','tenant:user');await assert.rejects(a.prepareDraft({...request,submit:true}),/draft-not-empty/);assert.equal(blocked.state().draft,'用户草稿');assert.equal(blocked.calls.some(c=>c[0]==='submit'),false);a.dispose();
 const same=fixture({draft:request.instruction}),b=new Owner(same.native,'session-1','tenant:user');await b.prepareDraft({...request,submit:true});assert.equal(same.calls.filter(c=>c[0]==='initialize').length,0);assert.equal(same.calls.filter(c=>c[0]==='submit').length,1);b.dispose();
});

test('uncertain native submission is not replayed by retry or remount',async()=>{
 const f=fixture({submitError:new Error('native transaction interrupted')}),r={id:'development-start:dev:revision',instruction:'开始已确认的开发',submit:true};let owner=new Owner(f.native,'session-1','tenant:user');
 await assert.rejects(owner.prepareDraft(r),/submit-unconfirmed/);await assert.rejects(owner.prepareDraft(r),/submit-unconfirmed/);assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);
 owner.dispose();owner=new Owner(f.native,'session-1','tenant:user');await owner.prepareDraft(r);assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);owner.dispose();
});

const devPrompt='/cordis-plugin-development /workdsh-workbench-dev\n\n开发指令';
const skillChips=[{occurrenceId:1,source:'skill',ref:'/cordis-plugin-development',clipboardText:'/cordis-plugin-development',offset:0,length:'/cordis-plugin-development'.length,label:'cordis-plugin-development'},{occurrenceId:2,source:'skill',ref:'/workdsh-workbench-dev',clipboardText:'/workdsh-workbench-dev',offset:'/cordis-plugin-development '.length,length:'/workdsh-workbench-dev'.length,label:'workdsh-workbench-dev'}];
test('native skill chips created during initialization do not block explicit development start',async()=>{
 const f=fixture({initializedOccurrences:skillChips}),owner=new Owner(f.native,'session-1','tenant:user');await owner.prepareDraft({id:'dev-with-skills',instruction:devPrompt,submit:true});assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);owner.dispose();
});
test('an identical generated draft with expected skill chips can resume without rewriting the editor',async()=>{
 const f=fixture({draft:devPrompt,occurrences:skillChips}),owner=new Owner(f.native,'session-1','tenant:user');await owner.prepareDraft({id:'resume-skills',instruction:devPrompt,submit:true});assert.equal(f.calls.filter(c=>c[0]==='submit').length,1);assert.equal(f.calls.some(c=>c[0]==='initialize'),false);owner.dispose();
});
test('user edits, file references, malformed skill spans and attachments still block automatic submission',async()=>{
 for(const changed of [{draft:devPrompt+'用户补充',occurrences:skillChips},{draft:devPrompt,occurrences:[{...skillChips[0],source:'file'}]},{draft:devPrompt,occurrences:[{...skillChips[0],offset:1}]},{draft:devPrompt,occurrences:[{...skillChips[0],invalid:true}]},{draft:devPrompt,occurrences:skillChips,attachmentIds:['user-file']}]){const f=fixture(changed),owner=new Owner(f.native,'session-1','tenant:user');await assert.rejects(owner.prepareDraft({id:'protect',instruction:devPrompt,submit:true}),/draft-not-empty/);assert.equal(f.calls.some(c=>c[0]==='submit'||c[0]==='initialize'),false);owner.dispose();}
});
