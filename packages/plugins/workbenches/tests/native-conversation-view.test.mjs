import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const webRequire = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const reactRequire = createRequire(new URL('../../../ui/package.json', import.meta.url));
const runtimeRequire = createRequire(new URL('../../../../apps/web/node_modules/.pnpm/runtime.cjs', import.meta.url));
const React = reactRequire('react');
const { renderToStaticMarkup } = runtimeRequire('react-dom/server');
let bridge;
const built = await webRequire('esbuild').build({ entryPoints: [fileURLToPath(new URL('../src/client/native-conversation.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react/jsx-runtime', './native-session-bridge.js'] });
const module = { exports: {} };
Function('require', 'module', 'exports', built.outputFiles[0].text)(id => id === './native-session-bridge.js' ? {NativeWorkbenchSessionBridge: props => {bridge=props;return null;}} : reactRequire(id), module, module.exports);
const {NativeWorkbenchConversation: Conversation,NativeWorkbenchConversationSeatProvider: Provider}=module.exports;
function fixture(overrides={}) {
 const opened=[],events=[],signal=new AbortController().signal;
 const html=renderToStaticMarkup(React.createElement(Provider,{seat:{signal,openSession:id=>{events.push('open');opened.push(id);}}},React.createElement(Conversation,{identityScopeKey:'owner',native:{},sessionId:'session-a',active:false,onDraftReady:id=>events.push(id),...overrides})));
 return {html,opened,events,signal,callbacks:bridge};
}
test('adapter renders no replacement conversation controls and opening an existing record does not navigate or submit',()=>{
 const f=fixture();assert.equal(f.html,'');assert.equal(f.callbacks.signal,f.signal);
 f.callbacks.onSessionChange('session-a');assert.deepEqual(f.opened,[]);assert.equal(f.callbacks.draftRequest,undefined);
});
test('successful draft transaction hands off to the complete native session after recording completion',()=>{
 const f=fixture({draftRequest:{id:'request-a'}});
 f.callbacks.onSessionChange('session-b');assert.deepEqual(f.opened,[]);
 f.callbacks.onDraftReady('request-a');assert.deepEqual(f.events,['request-a','open']);assert.deepEqual(f.opened,['session-b']);
});
test('draft conflict preserves the bridge error and opens the native session for inspection without retry',()=>{
 const errors=[],f=fixture({draftRequest:{id:'request-a'},onDraftError:(...args)=>errors.push(args)});
 const error=Error('draft-conflict');f.callbacks.onDraftError('request-a',error);
 assert.deepEqual(errors,[['request-a',error]]);assert.deepEqual(f.opened,['session-a']);
});
test('explicit active business conversation action uses the native session owner',()=>{
 const f=fixture({active:true});f.callbacks.onSessionChange('session-b');assert.deepEqual(f.opened,['session-b']);
});
