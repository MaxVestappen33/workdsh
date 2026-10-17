import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/QualityDrawer.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false,jsx:'transform',tsconfigRaw:{compilerOptions:{jsx:'react',jsxFactory:'React.createElement',jsxFragmentFactory:'React.Fragment'}},plugins:[{name:'drawer-hooks',setup(builder){
 builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'drawer-hooks'}));
 builder.onLoad({filter:/.*/,namespace:'drawer-hooks'},()=>({contents:`const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}})};export default React;export const useRef=(...args)=>globalThis.__drawerHooks.useRef(...args);export const useEffect=(...args)=>globalThis.__drawerHooks.useEffect(...args);`,loader:'js'}));
}}]});
const {QualityDrawer}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
function nodes(element){if(!element||typeof element!=='object')return [];if(Array.isArray(element))return element.flatMap(nodes);return [element,...nodes(element.props?.children)];}
function event(key,extra={}){return {key,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};}

// Exercise the actual component effects and events against instrumented dialog
// APIs. This verifies lifecycle/close guards, not rendered browser acceptance.
function withDrawer(options,run){
 const previousDocument=globalThis.document,previousElement=globalThis.HTMLElement;
 class Element{
  constructor(name){this.name=name;this.isConnected=true;this.listeners=new Map();}
  focus(){globalThis.document.activeElement=this;}
  closest(){return null;}
  getClientRects(){return [1];}
  querySelectorAll(){return this.items??[];}
  contains(node){return node===this||this.items?.includes(node);}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  removeEventListener(type,listener){if(this.listeners.get(type)===listener)this.listeners.delete(type);}
  setAttribute(name){if(name==='open')this.open=true;}
  removeAttribute(name){if(name==='open')this.open=false;}
 }
 const trigger=new Element('trigger'),panel=new Element('panel'),modal=new Element('dialog');
 modal.open=false;modal.shows=0;modal.closes=0;
 if(options.native!==false){modal.showModal=()=>{modal.shows++;if(options.showThrows)throw Error('unsupported-modal');modal.open=true;};modal.close=()=>{modal.closes++;modal.open=false;};}
 const first=new Element('first'),last=new Element('last');panel.items=options.empty?[]:[first,last];
 globalThis.HTMLElement=Element;globalThis.document={activeElement:trigger};
 const slots=[],effects=[];let cursor=0,tree,requests=0;
 const child={type:'div',props:{'data-test-child':'stable'}},props={open:false,title:'十月检验.xlsx',children:child,inline:options.inline??false,onClose:()=>requests++};
 const hooks={useRef(initial){const index=cursor++;return slots[index]??={current:initial};},useEffect(effect,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:effect()};});}};
 const api={props,panel,modal,first,last,trigger,child,get requests(){return requests;},get tree(){return tree;},render(){cursor=0;globalThis.__drawerHooks=hooks;try{tree=QualityDrawer(props);}finally{delete globalThis.__drawerHooks;}for(const node of nodes(tree))if(node.props?.ref)node.props.ref.current=node.type==='dialog'?modal:panel;while(effects.length)effects.shift()();},node(type){return nodes(tree).find(node=>node.type===type);},key(key,extra){const input=event(key,extra);panel.listeners.get('keydown')?.(input);return input;},cleanup(){for(const slot of slots)slot?.cleanup?.();}};
 try{api.render();run(api);}finally{api.cleanup();if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousElement===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=previousElement;}
}

test('drawer uses native modal top-layer API, keeps closed children, and restores focus on close/reopen',()=>withDrawer({},drawer=>{
 assert.equal(drawer.node('dialog').props.hidden,true);assert.equal(drawer.modal.shows,0);assert.ok(nodes(drawer.tree).includes(drawer.child));assert.equal(document.activeElement,drawer.trigger);
 drawer.props.open=true;drawer.render();assert.equal(drawer.modal.shows,1);assert.equal(drawer.modal.open,true);assert.equal(drawer.node('dialog').props.open,undefined);assert.equal(document.activeElement,drawer.first);
 drawer.render();assert.equal(drawer.modal.shows,1);
 drawer.props.open=false;drawer.render();assert.equal(drawer.modal.closes,1);assert.equal(drawer.modal.open,false);assert.equal(document.activeElement,drawer.trigger);assert.ok(nodes(drawer.tree).includes(drawer.child));assert.equal(drawer.panel.listeners.size,0);
 drawer.props.open=true;drawer.render();assert.equal(drawer.modal.shows,2);assert.equal(drawer.modal.open,true);
}));

test('Escape, cancel, backdrop and close button request closure without defeating a save guard',()=>withDrawer({},drawer=>{
 drawer.props.open=true;drawer.render();
 const escape=drawer.key('Escape');assert.equal(escape.prevented,true);assert.equal(escape.stopped,true);
 const cancel=event();drawer.node('dialog').props.onCancel(cancel);assert.equal(cancel.prevented,true);assert.equal(cancel.stopped,true);
 const dialog=drawer.node('dialog');dialog.props.onClick(event(undefined,{target:drawer.modal,currentTarget:drawer.modal}));
 drawer.node('button').props.onClick();assert.equal(drawer.requests,4);assert.equal(drawer.modal.open,true);assert.equal(drawer.modal.closes,0);
 dialog.props.onClick(event(undefined,{target:drawer.panel,currentTarget:drawer.modal}));assert.equal(drawer.requests,4);
 let latest=0;drawer.props.onClose=()=>latest++;drawer.render();drawer.key('Escape');assert.equal(latest,1);assert.equal(drawer.requests,4);assert.equal(drawer.modal.open,true);
 drawer.props.open=false;drawer.render();assert.equal(drawer.modal.closes,1);
}));

test('keyboard focus wraps inside the open modal',()=>withDrawer({},drawer=>{
 drawer.props.open=true;drawer.render();const backward=drawer.key('Tab',{shiftKey:true});assert.equal(backward.prevented,true);assert.equal(document.activeElement,drawer.last);
 const forward=drawer.key('Tab');assert.equal(forward.prevented,true);assert.equal(document.activeElement,drawer.first);
 drawer.trigger.focus();drawer.key('Tab');assert.equal(document.activeElement,drawer.first);
}));

test('a modal without focusable children focuses its panel and retains Tab there',()=>withDrawer({empty:true},drawer=>{
 drawer.props.open=true;drawer.render();assert.equal(document.activeElement,drawer.panel);assert.equal(drawer.key('Tab').prevented,true);assert.equal(document.activeElement,drawer.panel);
}));

test('missing showModal keeps a closable fallback and mounted children',()=>withDrawer({native:false},drawer=>{
 drawer.props.open=true;drawer.render();assert.equal(drawer.modal.open,true);assert.equal(document.activeElement,drawer.first);drawer.key('Escape');assert.equal(drawer.requests,1);assert.equal(drawer.modal.open,true);
 drawer.props.open=false;drawer.render();assert.equal(drawer.modal.open,false);assert.equal(document.activeElement,drawer.trigger);assert.ok(nodes(drawer.tree).includes(drawer.child));
}));

test('a rejecting showModal falls back without losing the close lifecycle',()=>withDrawer({showThrows:true},drawer=>{
 drawer.props.open=true;drawer.render();assert.equal(drawer.modal.shows,1);assert.equal(drawer.modal.open,true);drawer.props.open=false;drawer.render();assert.equal(drawer.modal.open,false);
}));

test('inline content retains its prior container and never starts a modal or focus trap',()=>withDrawer({inline:true},drawer=>{
 assert.equal(drawer.node('dialog'),undefined);assert.equal(drawer.node('div').props.className,'wd-quality-inline-panel');assert.ok(nodes(drawer.tree).includes(drawer.child));drawer.props.open=true;drawer.render();assert.equal(drawer.node('div').props.hidden,false);assert.equal(drawer.modal.shows,0);assert.equal(drawer.panel.listeners.size,0);assert.equal(document.activeElement,drawer.trigger);
}));

test('centered record dialog keeps the title and confirmation actions outside its scrollable body',()=>withDrawer({},drawer=>{
 const confirmation={type:'button',props:{children:['确认修改']}},subtitle='检验编号：INS-001';
 Object.assign(drawer.props,{open:true,placement:'center',className:'wd-quality-record-dialog',subtitle,footer:confirmation,closeLabel:'关闭详情'});drawer.render();
 const dialog=drawer.node('dialog'),panel=drawer.node('section');
 assert.ok(dialog.props.className.split(' ').includes('wd-quality-centered'));
 assert.ok(panel.props.className.split(' ').includes('wd-quality-record-dialog'));
 const parts=panel.props.children.flat(Infinity).filter(Boolean);
 assert.deepEqual(parts.map(part=>part.type),['header','div','footer']);
 const [header,body,footer]=parts;
 assert.equal(body.props.className,'wd-quality-modal-body');assert.ok(nodes(body).includes(drawer.child));
 assert.ok(!nodes(body).includes(header));assert.ok(!nodes(body).includes(confirmation));assert.ok(nodes(footer).includes(confirmation));
 assert.equal(footer.props.className,'wd-quality-modal-footer');
 assert.ok(nodes(header).some(node=>node.type==='p'&&node.props.children.includes(subtitle)));
 const close=nodes(header).find(node=>node.type==='button');assert.equal(close.props.children[0],'关闭详情');assert.equal(close.props['aria-label'],'关闭十月检验.xlsx');
 drawer.props.open=false;drawer.render();assert.ok(nodes(drawer.tree).includes(drawer.child));assert.ok(nodes(drawer.tree).includes(confirmation));assert.equal(document.activeElement,drawer.trigger);
}));

test('busy close guard immediately blocks every dismiss route and unlocks without reopening the modal',()=>withDrawer({},drawer=>{
 Object.assign(drawer.props,{open:true,placement:'center',closeDisabled:true});drawer.render();
 assert.equal(drawer.node('button').props.disabled,true);
 const dismissAll=()=>{
  const escape=drawer.key('Escape');assert.equal(escape.prevented,true);assert.equal(escape.stopped,true);
  const cancel=event();drawer.node('dialog').props.onCancel(cancel);assert.equal(cancel.prevented,true);assert.equal(cancel.stopped,true);
  drawer.node('dialog').props.onClick(event(undefined,{target:drawer.modal,currentTarget:drawer.modal}));
  drawer.node('button').props.onClick();
 };
 dismissAll();assert.equal(drawer.requests,0);assert.equal(drawer.modal.open,true);assert.equal(drawer.modal.closes,0);
 let latest=0;drawer.props.onClose=()=>latest++;drawer.props.closeDisabled=false;drawer.render();
 assert.equal(drawer.node('button').props.disabled,false);assert.equal(drawer.modal.shows,1);
 dismissAll();assert.equal(latest,4);assert.equal(drawer.requests,0);assert.equal(drawer.modal.open,true);
 drawer.props.closeDisabled=true;drawer.render();dismissAll();assert.equal(latest,4);assert.equal(drawer.modal.shows,1);
 drawer.props.open=false;drawer.render();assert.equal(drawer.modal.closes,1);assert.equal(document.activeElement,drawer.trigger);
}));

test('right drawers retain their existing direct child layout when centered placement is not requested',()=>withDrawer({},drawer=>{
 drawer.props.open=true;drawer.render();
 assert.ok(!drawer.node('dialog').props.className.split(' ').includes('wd-quality-centered'));
 assert.ok(drawer.node('section').props.children.flat(Infinity).includes(drawer.child));
 assert.ok(!nodes(drawer.tree).some(node=>node.props?.className==='wd-quality-modal-body'));
}));
