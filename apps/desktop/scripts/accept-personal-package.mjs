import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
const require=createRequire(new URL('../../web/package.json',import.meta.url))
const {chromium}=require('@playwright/test')
const app=process.env.WORKDSH_TEST_APP ?? new URL('../dist/mac-smoke/arm64/mac-arm64/PoliceAssistant.app',import.meta.url).pathname
const directory=mkdtempSync('/private/tmp/workdsh-package-gui-')
const report={app,directory,checks:{}}
const env={...process.env,WORKDSH_DESKTOP_USER_DATA:join(directory,'user-data'),npm_config_registry:'https://registry.npmmirror.com'}
for(const key of Object.keys(env)) if(/KEY|SECRET|TOKEN|PASSWORD|^DSH_|^NODE_OPTIONS$|^NODE_PATH$/.test(key)) delete env[key]
const log=createWriteStream(join(directory,'application.log'))
const child=spawn(join(app,'Contents/MacOS/PoliceAssistant'),['--remote-debugging-port=19531','--remote-debugging-address=127.0.0.1'],{env,stdio:['ignore','pipe','pipe']})
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
 const projectOperation=await personal.evaluate(async()=>{
 const call=async(endpoint,payload)=>{const r=await fetch('/api/workdsh-projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint,payload})});const j=await r.json();if(!j.ok)throw Error('Project operation failed: '+endpoint);return j.value};
 const created=await call('create',{name:'Package acceptance '+Date.now()});const id=created.project.id;await call('get',{projectId:id});await call('archive',{projectId:id});return Boolean(id);
 });
 report.checks.projectCreateReadArchive=projectOperation;
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
