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
const identity=process.env.WORKDSH_TEST_IDENTITY_ARCHIVE
const collaboration=process.env.WORKDSH_TEST_COLLABORATION_ARCHIVE
if(!identity||!collaboration) throw new Error('Provide WORKDSH_TEST_IDENTITY_ARCHIVE and WORKDSH_TEST_COLLABORATION_ARCHIVE for explicit test installation')
execFileSync(process.execPath,['--experimental-strip-types',new URL('./prepare-enterprise-acceptance.ts',import.meta.url).pathname,app,join(env.WORKDSH_DESKTOP_USER_DATA,'dsh-home'),identity,collaboration],{env,stdio:'pipe',timeout:240000})
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
 await entry.locator('#portal').fill(process.env.WORKDSH_TEST_BACKEND ?? 'http://127.0.0.1:19490')
 await entry.getByRole('button',{name:'企业登录',exact:true}).click({noWaitAfter:true})
 entry=await waitPage(p=>p.getByRole('heading',{name:'登录企业 Desktop'}).count())
 await entry.getByRole('heading',{name:'登录企业 Desktop'}).waitFor()
 report.checks.enterpriseLoginEntry=true
 report.checks.enterprisePasswordMasked=await entry.locator('#password').getAttribute('type')==='password'
 await entry.screenshot({path:join(directory,'enterprise-login.png')})
 const accounts=JSON.parse((await import('node:fs/promises')).readFile?await (await import('node:fs/promises')).readFile(process.env.WORKDSH_TEST_ACCOUNTS,'utf8'):'{}')
 const member=accounts.members[Number(process.env.WORKDSH_TEST_MEMBER??0)]
 await entry.locator('#account').fill(member.email)
 await entry.locator('#password').fill(member.password)
 await entry.getByRole('button',{name:'登录并在本机运行'}).click({noWaitAfter:true})
 const enterprise=await waitPage(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url())&&p.getByText('新会话',{exact:true}).count(),120000)
 await enterprise.getByText('协作',{exact:true}).first().waitFor({timeout:30000})
 report.checks.enterpriseCollaborationEntry=true
 await enterprise.getByText('项目',{exact:true}).first().waitFor({timeout:15000})
 report.checks.enterpriseProjectsEntry=true
 const previewContinue=enterprise.getByRole('button',{name:'继续',exact:true})
 if(await previewContinue.count()) await previewContinue.click()
 await enterprise.getByText('协作',{exact:true}).first().click()
 await enterprise.getByRole('heading',{name:'协作',exact:true}).waitFor()
 await enterprise.screenshot({path:join(directory,'collaboration.png')})
 const result=await enterprise.evaluate(async()=>{const r=await fetch('/api/workdsh-collaboration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:'colleagues'})});return {status:r.status,body:await r.json()}})
 report.checks.memberColleagues=result.status===200&&result.body.ok===true
 if(!report.checks.memberColleagues) throw new Error(JSON.stringify(result))
 report.checks.otherMemberVisible=result.body.value.some(row=>row.id!==member.id)
 const projectOperation=await enterprise.evaluate(async()=>{
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
