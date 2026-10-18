import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { registerBrowserView } from '../dist/browser-view.js';

test('captures the action browser for its owning session only', async () => {
  const handlers = new Map();
  let fetchHandler;
  let disposed = false;
  const image = { type: 'image', attachment: { mediaType: 'image/png', bytes: 4 } };
  const calls = [];
  const ctx = {
    effect: () => undefined,
    on(name, handler) { handlers.set(name, handler); },
    tools: { async execute(call) { calls.push(call); return { isError: false, content: [image] }; } },
    attachments: { async readImage() { return { data: Uint8Array.of(1, 2, 3, 4) }; } },
    connection: { fetch: { register({ fetch }) { fetchHandler = fetch; return () => { disposed = true; }; } } },
  };
  registerBrowserView(ctx);
  const agent = { session: { id: 'session-a' }, ctx: { effect: () => undefined } };
  handlers.get('agent/created')({ agent });
  const decision = { kind: 'accept' };
  const result = await handlers.get('tools/post-execute')({
    name: 'mcp__playwright-mcp__browser_navigate', arguments: { url: 'https://example.test/' },
    agent, callId: 'call-1', rootCallId: 'call-1', token: Symbol('call'),
  }, { isError: false, content: [] }, async () => decision);
  assert.equal(result, decision);
  await new Promise(resolve => setImmediate(resolve));
  const frameFor = async sessionId => {
    const response = await fetchHandler(new Request('http://localhost/api/workdsh-agent-browser', { method: 'POST', body: JSON.stringify({ sessionId }) }));
    return (await response.json()).frame;
  };
  assert.deepEqual(calls.map(call => call.name), ['mcp__playwright-mcp__browser_take_screenshot']);
  assert.equal(calls[0].agent, agent);
  assert.equal(calls[0].parent.description, 'call');
  assert.deepEqual(await frameFor('session-a'), {
    sessionId: 'session-a', revision: 1, url: 'https://example.test/',
    image: 'data:image/png;base64,AQIDBA==',
  });
  assert.equal(await frameFor('session-b'), null);
  assert.equal(disposed, false);
});

test('uses raw MCP screenshots when model-facing image projection is unavailable', async () => {
  const handlers = new Map();
  let fetchHandler;
  const ctx = {
    effect: () => undefined,
    on(name, handler) { handlers.set(name, handler); },
    tools: { async execute() { return {
      isError: false,
      content: [{ type: 'text', text: '[image unavailable]' }],
      value: { content: [{ type: 'image', mimeType: 'image/png', data: 'AQIDBA==' }] },
    }; } },
    attachments: { async readImage() { throw new Error('Raw image needs no store'); } },
    connection: { fetch: { register({ fetch }) { fetchHandler = fetch; return () => {}; } } },
  };
  registerBrowserView(ctx);
  const agent = { session: { id: 'session-raw' }, ctx: { effect: () => undefined } };
  await handlers.get('tools/post-execute')({
    name: 'mcp__playwright-mcp__browser_navigate', arguments: { url: 'https://example.test/' },
    agent, callId: 'call-raw', rootCallId: 'call-raw', token: Symbol('raw'),
  }, { isError: false, content: [] }, async () => undefined);
  await new Promise(resolve => setImmediate(resolve));
  const response = await fetchHandler(new Request('http://localhost/api/workdsh-agent-browser', { method: 'POST', body: JSON.stringify({ sessionId: 'session-raw' }) }));
  assert.equal((await response.json()).frame.image, 'data:image/png;base64,AQIDBA==');
});

function fixture(execute=async()=>({isError:false,content:[],value:{content:[{type:'image',mimeType:'image/png',data:'AQIDBA=='}]}}),readImage=async()=>({data:Uint8Array.of(1,2,3,4)})) {
  const handlers=new Map(),calls=[];let fetchHandler;
  registerBrowserView({effect:()=>undefined,on:(name,handler)=>handlers.set(name,handler),
    tools:{execute:async call=>{calls.push(call);return execute(call);}},attachments:{readImage},
    connection:{fetch:{register({fetch}){fetchHandler=fetch;return()=>{};}}}});
  const agent={session:{id:'session-close'},ctx:{effect:()=>undefined}};
  handlers.get('agent/created')({agent});
  return {calls,
    post:async(name,args={},isError=false)=>handlers.get('tools/post-execute')({name:'mcp__playwright-mcp__'+name,arguments:args,agent,rootCallId:'root',token:Symbol('call')},{isError,content:[]},async()=>undefined),
    async status(){return (await (await fetchHandler(new Request('http://localhost/api/workdsh-agent-browser',{method:'POST',body:JSON.stringify({sessionId:agent.session.id})}))).json());},
    async frame(){return (await this.status()).frame;},
  };
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('close and information tools never create a sidebar frame or trigger an automatic screenshot',async()=>{
  const f=fixture();
  for(const [name,args] of [
    ['browser_close',{}],['browser_tabs',{action:'close'}],['browser_tabs',{action:'list'}],
    ['list_mcp_resources',{}],['list_mcp_resource_templates',{}],['read_mcp_resource',{}],
    ['browser_console_messages',{}],['browser_network_requests',{}],['browser_install',{}],
    ['browser_start_tracing',{}],['browser_stop_tracing',{}],['browser_generate_locator',{}],
    ['browser_take_screenshot',{}],['browser_unknown_information',{}],
  ]){await f.post(name,args);await settle();assert.equal(await f.frame(),null,name);}
  assert.deepEqual(f.calls,[]);
});

test('navigate and snapshot retain normal page display; successful close clears it and failed close does not invent success',async()=>{
  const f=fixture();
  assert.equal((await f.status()).activity,null,'an untouched session is unknown, not closed');
  await f.post('browser_navigate',{url:'https://example.test/'});await settle();
  assert.equal((await f.frame()).revision,1);assert.equal(f.calls.length,1);
  await f.post('browser_snapshot');await settle();
  assert.equal((await f.frame()).revision,2);assert.equal(f.calls.length,2);
  await f.post('browser_close',{},true);await settle();assert.equal((await f.frame()).revision,2);
  await f.post('browser_close');await settle();assert.equal(await f.frame(),null);assert.equal(f.calls.length,2);
  assert.deepEqual((await f.status()).activity,{active:false,revision:3});
  await f.post('browser_tabs',{action:'new'});await settle();assert.equal((await f.frame()).revision,4);
  assert.deepEqual((await f.status()).activity,{active:true,revision:4});
  await f.post('browser_tabs',{action:'close'});await settle();assert.equal(await f.frame(),null);assert.equal(f.calls.length,3);
  assert.deepEqual((await f.status()).activity,{active:false,revision:5});
});

test('close cancels queued captures before they can recreate a browser',async()=>{
  const f=fixture();
  await Promise.all([f.post('browser_navigate',{url:'https://example.test/'}),f.post('browser_close')]);
  await settle();assert.equal(await f.frame(),null);assert.equal(f.calls.length,0);
});

test('an in-flight old screenshot cannot resurrect a closed page or overwrite a newly opened frame',async()=>{
  let finish;const f=fixture(call=>new Promise(resolve=>{finish=resolve;}));
  await f.post('browser_navigate',{url:'https://old.test/'});await settle();
  assert.equal(f.calls.length,1);const oldFinish=finish,oldSignal=f.calls[0].signal;
  await f.post('browser_close');assert.equal(oldSignal.aborted,true);assert.equal(await f.frame(),null);
  await f.post('browser_navigate',{url:'https://new.test/'});await settle();
  const nextFinish=finish;
  oldFinish({isError:false,content:[],value:{content:[{type:'image',mimeType:'image/png',data:'T0xE'}]}});
  await settle();assert.equal((await f.frame()).url,'https://new.test/');assert.equal((await f.frame()).image,undefined);
  nextFinish({isError:false,content:[],value:{content:[{type:'image',mimeType:'image/png',data:'TkVX'}]}});
  await settle();assert.equal((await f.frame()).image,'data:image/png;base64,TkVX');
});

test('close during attachment decoding cannot restore the old frame',async()=>{
  let decode;const f=fixture(async()=>({isError:false,content:[{type:'image',attachment:{mediaType:'image/png',bytes:4}}]}),()=>new Promise(resolve=>{decode=resolve;}));
  await f.post('browser_snapshot');await settle();assert.equal(typeof decode,'function');
  await f.post('browser_close');decode({data:Uint8Array.of(1,2,3,4)});await settle();
  assert.equal(await f.frame(),null);assert.equal(f.calls.length,1);
});

const browserKind='workdsh-agent-browser';
const clientCode=await readFile(new URL('../dist/client.js',import.meta.url),'utf8');
const require=createRequire(new URL('../package.json',import.meta.url));
function clientFixture(status,{providerEnabled=false}={}) {
  let apply,timer,current='first',disposed=false,serial=0;
  const cleanups=[],listeners=new Set(),tabs=[],opens=[],closes=[];
  const context={URL,AbortController,AbortSignal,console,
    fetch:async(_url,options)=>Response.json(await status(JSON.parse(options.body))),
    window:{location:{href:'https://application.test/'},setInterval(callback){timer=callback;return 1;},clearInterval(){},
      __ModuleLoader__:{load(module){apply=module.factory(id=>id==='@deepseek-ai/dsh-client-ui-primitives'?{}:require(id)).apply;}}},
  };
  runInNewContext(clientCode,context);
  apply({
    inject(){return()=>{};},plugin(){},
    effect(body){const stop=body();if(typeof stop==='function')cleanups.push(stop);},
    slots:{inject(_slot,body){const stop=body();if(typeof stop==='function')cleanups.push(stop);},register(){return()=>{};},entriesOfSlot(){return[];}},
    layout:{selectPanel(){}},
    remote:{pluginInventory:{async list(){return{ok:true,value:{entries:providerEnabled?[{moduleName:'workdsh-provider-browser-session',enabled:true}]:[]}};}}},
    sidebarRightTabs:{register(){return()=>{};}},
    sidebarRight:{
      openTabs:{getSnapshot:()=>tabs},
      openTabIn(sessionId,kind){opens.push({sessionId,kind});tabs.push({sessionId,kind,tabId:'tab-'+ ++serial});},
      closeIn(sessionId,tabId){closes.push({sessionId,tabId});const index=tabs.findIndex(row=>row.sessionId===sessionId&&row.tabId===tabId);if(index>=0)tabs.splice(index,1);},
    },
    sessions:{list:{getSnapshot:()=>({byId:current?{[current]:{id:current,retainedBy:{mainView:1}}}:{}}),subscribe(callback){listeners.add(callback);return()=>listeners.delete(callback);}}},
  });
  return{tabs,opens,closes,
    tick(){timer();},select(id){current=id;for(const listener of listeners)listener();},
    dispose(){if(disposed)return;disposed=true;for(const stop of cleanups.reverse())stop();},
  };
}
const activity=(sessionId,revision,active=true)=>({activity:{revision,active},frame:active?{sessionId,revision}:null,unchanged:false});

test('actual Client apply opens only new browser activity and closes only its own exact Session pane',async()=>{
  let state={activity:null,frame:null};const f=clientFixture(()=>state);
  try{
    await settle();f.tabs.push({sessionId:'first',kind:'files',tabId:'file-tab'},{sessionId:'second',kind:browserKind,tabId:'other-browser'});
    f.tick();await settle();assert.equal(f.opens.length,0);assert.equal(f.closes.length,0);
    state=activity('first',1);f.tick();await settle();assert.deepEqual(f.opens,[{sessionId:'first',kind:browserKind}]);
    const own=f.tabs.find(row=>row.sessionId==='first'&&row.kind===browserKind);f.tabs.splice(f.tabs.indexOf(own),1);
    f.tick();await settle();assert.equal(f.opens.length,1,'manual close is respected for the same activity');
    state=activity('first',2);f.tick();await settle();assert.equal(f.opens.length,2,'new real activity can reopen');
    const reopened=f.tabs.find(row=>row.sessionId==='first'&&row.kind===browserKind);
    state=activity('first',3,false);f.tick();await settle();assert.deepEqual(f.closes,[{sessionId:'first',tabId:reopened.tabId}]);
    assert.equal(f.tabs.some(row=>row.tabId==='file-tab'),true);assert.equal(f.tabs.some(row=>row.tabId==='other-browser'),true);
    f.tick();await settle();assert.equal(f.closes.length,1);assert.equal(f.opens.length,2);
  }finally{f.dispose();}
});

test('unavailable, malformed and other-Session facts cannot close or open a manual pane',async()=>{
  let state;const f=clientFixture(()=>state);
  try{
    await settle();f.tabs.push({sessionId:'first',kind:browserKind,tabId:'manual'});
    for(const value of [{frame:null},{activity:{active:false,revision:0}},{activity:{active:'false',revision:1}},activity('other',1)]){
      state=value;f.tick();await settle();assert.equal(f.closes.length,0);assert.equal(f.opens.length,0);
    }
    state={activity:null,frame:null};f.tick();await settle();assert.equal(f.tabs.length,1);
  }finally{f.dispose();}
});

test('Client late poll cannot steal another Session, return after a switch-away-and-back, or open after dispose',async()=>{
  let finish;const f=clientFixture(()=>new Promise(resolve=>{finish=resolve;}));
  try{
    await settle();f.tick();await settle();f.select('second');finish(activity('first',1));await settle();assert.equal(f.opens.length,0);
    f.select('first');f.tick();await settle();f.select('second');f.select('first');finish(activity('first',2));await settle();assert.equal(f.opens.length,0);
    f.tick();await settle();f.dispose();finish(activity('first',3));await settle();assert.equal(f.opens.length,0);assert.equal(f.closes.length,0);
  }finally{f.dispose();}
});

test('closing a pane while its first status is pending is not undone by the late response',async()=>{
  let finish;const f=clientFixture(()=>new Promise(resolve=>{finish=resolve;}));
  try{
    await settle();const manual={sessionId:'first',kind:browserKind,tabId:'manual'};f.tabs.push(manual);
    f.tick();await settle();f.tabs.splice(f.tabs.indexOf(manual),1);finish(activity('first',1));await settle();assert.equal(f.opens.length,0);
  }finally{f.dispose();}
});

test('the managed provider owning its own tab prevents legacy polling and tab selection',async()=>{
  let reads=0;const f=clientFixture(()=>{reads++;return activity('first',1);},{providerEnabled:true});
  try{await settle();f.tick();await settle();assert.equal(reads,0);assert.equal(f.opens.length,0);assert.equal(f.closes.length,0);}finally{f.dispose();}
});
