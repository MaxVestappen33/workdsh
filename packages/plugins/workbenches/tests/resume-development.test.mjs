import test from 'node:test';import assert from 'node:assert/strict';import {createRequire}from'node:module';import{fileURLToPath}from'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const result=await build({entryPoints:[fileURLToPath(new URL('../src/client/resume-development.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {prepareWorkbenchResume,resumeFailureMessage}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const canonicalBuilt=await build({entryPoints:[fileURLToPath(new URL('../src/client/development-instruction.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createWorkbenchDevelopmentInstruction}=await import(`data:text/javascript;base64,${Buffer.from(canonicalBuilt.outputFiles[0].text).toString('base64')}`);
const owner={organizationId:'org',ownerPrincipalId:'member'};
const saved={id:'latest',developmentId:'dev',owner,requirements:{title:'质量趋势',scenario:'检验分析',users:'质量人员',dataSources:'CSV',workflow:'导入分析报告',firstIteration:'完成趋势与可编辑报告',acceptance:'导入后可以加工报告'}};
const entry={title:'质量趋势',development:{id:'dev',revision:'rev',requirementsRevision:'latest',owner,workbenchId:'company.quality',packageName:'quality-plugin',session:{hostId:'host',sessionId:'same-native-session'}}};
test('resume reads the latest requirements, verifies the same Session, and prepares a new-round draft without saving or sending',async()=>{
 const calls=[];const client={async list(){calls.push('list');return[entry]},async ensureSession(id,revision){calls.push('ensure');assert.equal(id,'dev');assert.equal(revision,'rev');return entry}};
 const prepared=await prepareWorkbenchResume(client,{async history(){calls.push('history');return[{...saved,id:'old'},saved]}},'dev');
 assert.equal(prepared.instruction,createWorkbenchDevelopmentInstruction(saved,entry.development),'continuation must match the unsubmitted confirmation draft byte for byte');
 assert.deepEqual(calls,['list','ensure','history']);assert.equal(prepared.entry.development.session.sessionId,'same-native-session');
 assert.doesNotMatch(prepared.instruction,/上一轮仅核验安装/);assert.equal(prepared.requirements.firstIteration,saved.requirements.firstIteration);assert.match(prepared.instruction,/保留原生会话、Office、模型选择与授权/);assert.match(prepared.instruction,/完成趋势与可编辑报告/);
});
test('resume rejects changed requirements or a moved installation instead of producing stale instructions',async()=>{
 await assert.rejects(prepareWorkbenchResume({async list(){return[entry]},async ensureSession(){return entry}},{async history(){return[{...saved,id:'different'}]}},'dev'),/requirements-revision-conflict/);
 let history=false;await assert.rejects(prepareWorkbenchResume({async list(){return[entry]},async ensureSession(){throw Error('workbench/installation-target-changed')}},{async history(){history=true;return[saved]}},'dev'),/installation-target-changed/);assert.equal(history,false);
});

test('continuation exposes actionable sanitized failures for typed client errors',()=>{
 assert.match(resumeFailureMessage(Object.assign(new Error('private /home/secret'),{code:'workbench/installation-target-changed'})),/重新打包不能修复/);
 assert.match(resumeFailureMessage(Error('workbench/requirements-revision-conflict')),/重新核对/);
 assert.match(resumeFailureMessage(Error('workbench/development-source-unavailable')),/原开发目录/);
 assert.doesNotMatch(resumeFailureMessage(Error('private /home/secret')),/secret/);
});
