/** Read published contracts and exercise the public SlotCore ownership rules.
 * This is a headless API probe, not a rendered UI or full Session acceptance. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.argv[2];
if(!root)throw Error('Usage: node probe-native-conversation-layout.mjs <package-resolution-directory> [report.json]');
const require=createRequire(resolve(root,'package.json'));
const manifestPath=require.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const text=await readFile(join(dirname(manifestPath),'lib/types/client/contract/slots.d.ts'),'utf8');
const ts=await import(pathToFileURL(require.resolve('typescript')).href);
const source=ts.createSourceFile('slots.d.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const factories=new Map();
function propertyName(member){return member.name && (ts.isStringLiteral(member.name)||ts.isIdentifier(member.name))?member.name.text:undefined;}
function visit(node){
 if(ts.isInterfaceDeclaration(node)&&node.name.text==='SlotFactoryMap')for(const member of node.members){
  const name=propertyName(member);if(!name||!member.type||!ts.isTypeLiteralNode(member.type))continue;
  const children=member.type.members.find(m=>propertyName(m)==='children');
  factories.set(name,children?.type&&ts.isTypeLiteralNode(children.type)?children.type.members.map(propertyName).filter(Boolean):[]);
 }
 ts.forEachChild(node,visit);
}
visit(source);
assert.ok(factories.has('conversation.content'),'Published content factory must exist to evaluate this route.');
const {SlotCore}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-slots')).href);
const registry=new SlotCore(),dispose=[];
try{
 // Minimal declaration topology matching the published main Conversation owner.
 // Components are inert: no private component, browser DOM, Session, or model.
 dispose.push(registry.register({name:'root',children:{main:{kind:'keyed',scope:'root'}}},()=>null));
 dispose.push(registry.register({name:'main',key:'conversation',children:{'main.conversation':{kind:'single',scope:'session-maybe'}}},()=>null));
 dispose.push(registry.register({name:'main.conversation',children:{'conversation.header':{kind:'single',scope:'session-maybe'}}},()=>null));
 dispose.push(registry.register({name:'main',key:'workdsh-layout-probe'},()=>null));
 assert.equal(registry.entriesOfSlot('main').length,2,'Owned business main panel may coexist.');
 let duplicateError;
 try{registry.register({name:'main',key:'workdsh-wrap-probe',children:{'main.conversation':{kind:'single',scope:'session-maybe'}}},()=>null);}
 catch(error){duplicateError=error.message;}
 assert.match(duplicateError??'',/already declared/,'Business wrapper cannot redeclare the native child Slot.');
 assert.equal(registry.entriesOfSlot('main').length,2,'Rejected duplicate must not leave a partial entry.');
 const report={runtimeVersion:manifest.version,probe:'published-types-and-real-SlotCore',
  businessMainPanelRegistration:true,nativeConversationDuplicateRejected:true,duplicateError,
  contentFactory:factories.has('conversation.content'),contentFactoryChildren:factories.get('conversation.content'),
  contentFactoryIncludesHeader:factories.get('conversation.content').includes('conversation.header'),
  fullConversationFactory:factories.has('main.conversation'),
  headerFactory:factories.has('conversation.header'),
  publicFactoryNames:[...factories.keys()],officialFilesChanged:false,guiVerified:false,
  requestedFullNativeSideBySideVerified:false,
  conclusion:'Independent business main panels work. The content factory does not expose the native header, and redeclaring the resident main Conversation Slot is rejected. These routes do not establish an equivalent full native side-by-side composition.'};
 if(process.argv[3])await writeFile(resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{for(const stop of dispose.reverse())stop();assert.equal(registry.entriesOfSlot('main').length,0);}
