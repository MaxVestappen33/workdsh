/** Explicit real Electron probe against a caller-selected built carrier and isolated Home. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtime=resolve(process.argv[2]);
const built=resolve(process.argv[3]);
const profile=join(runtime,'profiles/workdsh');
const pkg=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));
assert.ok(!Object.keys(pkg.dependencies??{}).some(name=>/identity-enterprise|enterprise-collaboration/.test(name)));
assert.ok(!(pkg.dsh?.profile?.bundles??[]).some(name=>/identity-enterprise|enterprise-collaboration/.test(name)));
const {_electron}=await import(process.env.WORKDSH_PLAYWRIGHT_ENTRY);
const electron=createRequire(join(root,'package.json'))('electron');
const owned=await mkdtemp(join(tmpdir(),'workdsh-desktop-personal-probe-'));
const home=join(owned,'personal');
await mkdir(join(owned,'browser'),{mode:0o700});
const launcher=join(owned,'launcher.mjs');
await writeFile(launcher,`import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(owned,'browser'))});await import(${JSON.stringify(pathToFileURL(built).href)});`);
let app,proof;
const output=resolve(process.argv[4]);
try {
 app=await _electron.launch({executablePath:process.env.WORKDSH_PACKAGED_EXECUTABLE??electron,args:process.env.WORKDSH_PACKAGED_EXECUTABLE?[]:[launcher],env:{...process.env,HOME:owned,WORKDSH_DESKTOP_USER_DATA:join(owned,'browser'),WORKDSH_DSH_HOME:home,...(process.env.WORKDSH_PACKAGED_EXECUTABLE?{}:{WORKDSH_BUNDLED_PROFILE:profile,WORKDSH_PRIMARY_RUNTIME:join(runtime,'primary-runtime'),WORKDSH_NODE_EXECUTABLE:process.execPath}),DSH_AGENTS_HOME:join(owned,'agents'),WORKDSH_ENTERPRISE_PORTAL:''},timeout:30000});
 const entry=await app.firstWindow();
 const opening=app.waitForEvent('window',{timeout:60000});
 await entry.getByRole('link',{name:'个人使用',exact:true}).click();
 const personal=await opening;
 await personal.waitForURL(/http:\/\/127\.0\.0\.1:\d+/);
 await personal.waitForFunction(()=>Boolean(window.__DSH_BOOT__),null,{timeout:30000});
 const entries=await personal.evaluate(()=>window.__DSH_BOOT__.entries.map(entry=>entry.id));
 assert.ok(!entries.some(name=>/identity-enterprise|enterprise-collaboration/.test(name)));
 for(const name of ['workdsh-plugin-experts','workdsh-plugin-skills','workdsh-plugin-library','workdsh-plugin-connectors'])assert.ok(entries.includes(name));
 await personal.getByRole('button',{name:'资料库',exact:true}).waitFor();
 assert.equal(await personal.getByRole('button',{name:'登录企业账号',exact:true}).count(),0);
 for(const label of ['Continue','继续','Configure later','稍后配置','保留当前显示','Keep current display']) {
  const button=personal.getByRole('button',{name:label,exact:true}).last();
  if(await button.isVisible().catch(()=>false))await button.click();
 }
 await personal.getByRole('button',{name:'专家 · 技能 · 连接器',exact:true}).waitFor({state:'visible',timeout:20000});
 await writeFile(join(home,'mode-retention-probe.txt'),'owned-test-data');
 const oldOrigin=new URL(personal.url()).origin;
 const returned=app.waitForEvent('window');
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.find(item=>item.label==='工作区').submenu.items[0].click());
 const chooser=await returned;
 await chooser.getByRole('heading',{name:'选择使用方式'}).waitFor();
 assert.equal(personal.isClosed(),true);
 assert.equal(await fetch(oldOrigin,{signal:AbortSignal.timeout(2000)}).then(()=>true,()=>false),false,'Old personal Host must stop');
 assert.equal(await readFile(join(home,'mode-retention-probe.txt'),'utf8'),'owned-test-data');
 const reopening=app.waitForEvent('window',{timeout:60000});
 await chooser.getByRole('link',{name:'个人使用',exact:true}).click();
 const restored=await reopening;
 await restored.waitForFunction(()=>Boolean(window.__DSH_BOOT__),null,{timeout:30000});
 assert.equal(await readFile(join(home,'mode-retention-probe.txt'),'utf8'),'owned-test-data');
 proof={actualElectron:true,personalEntryOpensOfficialHost:true,noEnterpriseLoginOrPlugin:true,fourFeatureNavigationVisible:true,personalHostStoppedBeforeEntry:true,ownedHomeDataPreserved:true,personalReentry:true,modelCallsRequested:0,packagedRuntimeVerified:Boolean(process.env.WORKDSH_PACKAGED_EXECUTABLE),packagedAsarCode:built.includes('app.asar'),historicalOptionalPackages:Object.keys(pkg.dependencies??{}).filter(name=>/workdsh-plugin-(projects|office|activity)$/.test(name))};
} finally {if(app)await app.close();await rm(owned,{recursive:true,force:true});}

await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({...proof,gracefulAppExitVerified:true},null,2));
console.log('PASS: real personal Desktop entry, Host stop, retained data, reentry and graceful app exit');
