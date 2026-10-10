/** Official UI installation acceptance in fresh isolated application data. */
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { once } from 'node:events'
const require=createRequire(new URL('../../web/package.json',import.meta.url))
const {chromium}=require('@playwright/test')
const app=process.env.WORKDSH_TEST_APP ?? new URL('../dist/mac-smoke/arm64/mac-arm64/PoliceAssistant.app',import.meta.url).pathname
for(const key of ['WORKDSH_TEST_ENTERPRISE_ARCHIVE','WORKDSH_TEST_ACCOUNTS','WORKDSH_TEST_BACKEND']) if(!process.env[key]) throw new Error('Missing acceptance configuration: '+key)
const directory=mkdtempSync('/private/tmp/workdsh-package-gui-')
const report={app,directory,checks:{}}
const env={...process.env,WORKDSH_DESKTOP_USER_DATA:join(directory,'user-data'),npm_config_registry:'https://registry.npmmirror.com'}
for(const key of Object.keys(env)) if(/KEY|SECRET|TOKEN|PASSWORD|^DSH_|^NODE_OPTIONS$|^NODE_PATH$/.test(key)) delete env[key]
const log=createWriteStream(join(directory,'application.log'))
let child=spawn(join(app,'Contents/MacOS/PoliceAssistant'),['--remote-debugging-port=19531','--remote-debugging-address=127.0.0.1'],{env,stdio:['ignore','pipe','pipe']})
child.stdout.pipe(log); child.stderr.pipe(log)
let browser
try {
 for(let pass=0;pass<100;pass++) {
  try {browser=await chromium.connectOverCDP('http://127.0.0.1:19531');break} catch {await new Promise(r=>setTimeout(r,200))}
 }
 if(!browser) throw new Error('Candidate did not open its test browser endpoint')
 const pages=()=>browser.contexts().flatMap(c=>c.pages())
 async function waitPage(test,timeout=20000) { const until=Date.now()+timeout; while(Date.now()<until) { for(const p of pages()) { try {if(!p.isClosed() && await test(p)) return p} catch {}} await new Promise(r=>setTimeout(r,100)) } throw new Error('Expected application page did not appear') }
 let entry=pages()[0]
 await entry.getByRole('heading',{name:'选择使用方式'}).waitFor({timeout:20000})
 report.checks.connectionEntry=true
 await entry.screenshot({path:join(directory,'entry.png')})
 report.checks.enterpriseRequiresInstallation=await entry.getByRole('button',{name:'请先安装企业账号插件',exact:true}).isDisabled()
 await entry.getByRole('link',{name:'个人使用'}).click({noWaitAfter:true})
 const loading=await waitPage(p=>p.locator('[aria-busy=true]').count())
 report.checks.visibleLoadingTransition=true
 try {await loading.screenshot({path:join(directory,'loading.png')})} catch {}
 const personal=await waitPage(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url())&&p.getByText('新会话',{exact:true}).count(),120000)
 const text=await personal.locator('body').innerText()
 report.checks.personalOfficialUi=true
 await personal.getByText('项目',{exact:true}).first().waitFor({timeout:15000})
 report.checks.personalProjectsEntry=true
 report.checks.personalCollaborationInactive=await personal.getByText('协作',{exact:true}).count()===0
 report.checks.settingsPresent=text.includes('设置')
 report.checks.pluginsPresent=text.includes('插件')
 await personal.screenshot({path:join(directory,'personal.png')})
 const previewContinue=personal.getByRole('button',{name:'继续',exact:true});try{await previewContinue.waitFor({timeout:10000});await previewContinue.click()}catch(error){if(!/Timeout/.test(error.message))throw error}
 await personal.getByText('插件',{exact:true}).first().click();
 await personal.getByRole('button',{name:'添加插件',exact:true}).click();
 await personal.getByPlaceholder('例如 dsh-plugin-whale-pet').fill(process.env.WORKDSH_TEST_ENTERPRISE_ARCHIVE);
 await personal.getByRole('button',{name:'安装',exact:true}).click();
 await personal.getByRole('button',{name:'立即启用',exact:true}).waitFor({timeout:180000});
 await personal.getByRole('button',{name:'立即启用',exact:true}).click();
 await personal.getByText('插件安装中…',{exact:true}).waitFor({state:'hidden',timeout:180000});
 await personal.screenshot({path:join(directory,'installed-enterprise-plugin.png')});
 report.checks.installedThroughOfficialUi=true;
 await personal.getByText('设置',{exact:true}).first().click();
 await personal.getByText('企业账号',{exact:true}).first().click();
 await personal.getByRole('button',{name:'连接企业',exact:true}).waitFor({timeout:30000});
 await personal.screenshot({path:join(directory,'enterprise-connect.png')});
 await personal.getByRole('button',{name:'连接企业',exact:true}).click({noWaitAfter:true});
 const connectedEntry=await waitPage(p=>p.getByRole('heading',{name:'选择使用方式'}).count(),30000);
 report.checks.pluginConnectEntry=true;
 report.checks.enterpriseLoginEnabled=await connectedEntry.getByRole('button',{name:'企业登录',exact:true}).isEnabled();
 await connectedEntry.locator('#portal').fill(process.env.WORKDSH_TEST_BACKEND);
 await connectedEntry.getByRole('button',{name:'企业登录',exact:true}).click({noWaitAfter:true});
 const loginPage=await waitPage(p=>p.locator('#account').count());
 const accounts=JSON.parse(readFileSync(process.env.WORKDSH_TEST_ACCOUNTS,'utf8'));
 await loginPage.locator('#account').fill(accounts.members[0].email);
 await loginPage.locator('#password').fill(accounts.members[0].password);
 await loginPage.getByRole('button',{name:'登录并在本机运行'}).click({noWaitAfter:true});
 const enterprise=await waitPage(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url())&&p.getByText('新会话',{exact:true}).count(),180000);
 const enterpriseContinue=enterprise.getByRole('button',{name:'继续',exact:true});if(await enterpriseContinue.count())await enterpriseContinue.click();
 await enterprise.getByText('协作',{exact:true}).first().click();
 await enterprise.getByRole('heading',{name:'协作',exact:true}).waitFor();
 report.checks.enterpriseCollaborationActive=true;
 await enterprise.getByText('设置',{exact:true}).first().click();
 await enterprise.getByText('企业账号',{exact:true}).first().click();
 await enterprise.getByRole('button',{name:'退出企业账号',exact:true}).click();
 await waitPage(p=>p.getByRole('heading',{name:'选择使用方式'}).count(),30000);
 report.checks.enterpriseLogout=true;
 await browser.close();browser=undefined;
 const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;
 child=spawn(join(app,'Contents/MacOS/PoliceAssistant'),['--remote-debugging-port=19531','--remote-debugging-address=127.0.0.1'],{env,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log);child.stderr.pipe(log);
 for(let pass=0;pass<100;pass++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19531');break}catch{await new Promise(r=>setTimeout(r,200))}}
 if(!browser)throw new Error('Restart did not expose test endpoint');
 const restarted=await waitPage(p=>p.getByRole('heading',{name:'选择使用方式'}).count(),30000);
 report.checks.enterprisePluginSurvivesRestart=await restarted.getByRole('button',{name:'企业登录',exact:true}).isEnabled();
 report.checks.backendRemembered=await restarted.locator('#portal').inputValue()===process.env.WORKDSH_TEST_BACKEND;
 await restarted.getByRole('link',{name:'个人使用'}).click({noWaitAfter:true});
 const returnedPersonal=await waitPage(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url())&&p.getByText('新会话',{exact:true}).count(),120000);
 await returnedPersonal.getByText('项目',{exact:true}).first().waitFor();
 report.checks.personalAfterLogout=true;
 await returnedPersonal.getByText('插件',{exact:true}).first().click();
 await returnedPersonal.getByText('workdsh-enterprise-connection',{exact:true}).click();
 await returnedPersonal.getByRole('button',{name:/卸载.*workdsh-enterprise-connection/}).click();
 await returnedPersonal.getByRole('button',{name:'卸载',exact:true}).click();
 await returnedPersonal.getByText('workdsh-enterprise-connection',{exact:false}).first().waitFor({state:'hidden',timeout:60000});
 report.checks.uninstalledThroughOfficialUi=true;
 const personalManifest=JSON.parse(readFileSync(join(env.WORKDSH_DESKTOP_USER_DATA,'dsh-home/profiles/workdsh/package.json'),'utf8'));
 report.checks.enterpriseDependencyRemoved=!personalManifest.dependencies?.['workdsh-enterprise-connection'];
 await returnedPersonal.getByRole('button',{name:'添加插件',exact:true}).click();
 await returnedPersonal.getByPlaceholder('例如 dsh-plugin-whale-pet').fill(process.env.WORKDSH_TEST_ENTERPRISE_ARCHIVE);
 await returnedPersonal.getByRole('button',{name:'安装',exact:true}).click();
 await returnedPersonal.getByRole('button',{name:'立即启用',exact:true}).waitFor({timeout:180000});
 await returnedPersonal.getByRole('button',{name:'立即启用',exact:true}).click();
 await returnedPersonal.getByText('插件安装中…',{exact:true}).waitFor({state:'hidden',timeout:180000});
 report.checks.reinstalledThroughOfficialUi=true;


 const resources=join(app,'Contents/Resources/workdsh-runtime')
 const output=execFileSync(join(resources,'runtime/cli/bin/dsh'),['--version'],{env,encoding:'utf8',timeout:30000})
 report.checks.bundledDshCommandVersion=output.trim()
 const node=join(resources,'primary-runtime/dependencies/node/bin/node')
 const inspection=JSON.parse(execFileSync(node,[join(resources,'runtime/cli/command-manager.js'),'inspect'],{env,encoding:'utf8',timeout:30000}))
 report.checks.officialCommandInspector=inspection.ok===true
 report.checks.commandDestination=inspection.state?.destination
 report.ok=Object.values(report.checks).every(Boolean)
} catch(error) {report.ok=false;report.error=error.message}
finally {
 if(browser) {try {await browser.close()} catch {}}
 if(child.exitCode===null) child.kill('SIGTERM')
 writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report,null,2))
}

if(!report.ok) process.exitCode=1
