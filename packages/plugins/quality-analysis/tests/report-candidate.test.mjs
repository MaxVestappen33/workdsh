import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
// Bundle the real browser helper: a runtime/interpretation-candidate value
// import would pull node:crypto into this browser build and fail this check.
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/report-candidate.ts',import.meta.url))],bundle:true,platform:'browser',format:'esm',write:false});
const {reportCandidateMatchesRun,reportCandidatesEqual,appendReportAnalysisCandidate}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const run=Object.freeze({recordId:'record',runId:'fixed-run',contentHash:'a'.repeat(64)});
const candidate=()=>({...run,sessionId:'session-'+ 'b'.repeat(32),eventSeq:12,turn:2,text:'  检验数据的变化需要复核。\n不可据此断言原因。  ',candidateHash:'c'.repeat(64)});
const fields=()=>({title:'',analysis:'原来的分析说明\n保留尾部空格 ',conclusion:'既有结论',recommendations:'既有建议'});

test('candidate checks the complete fixed scope and finite native reply identity',()=>{
 assert.equal(reportCandidateMatchesRun(candidate(),run),true);
 for(const changed of [{recordId:'other'},{runId:'old-run'},{contentHash:'d'.repeat(64)},{sessionId:'other'},{eventSeq:-1},{eventSeq:NaN},{turn:1.5},{turn:-1},{text:' \n\t'},{text:'a'.repeat(64*1024+1)},{candidateHash:'invalid'},{extra:'unknown'}]){
  assert.equal(reportCandidateMatchesRun({...candidate(),...changed},run),false);
 }
 const incomplete=candidate();delete incomplete.eventSeq;assert.equal(reportCandidateMatchesRun(incomplete,run),false);
 assert.equal(reportCandidateMatchesRun(null,run),false);
 for(const changed of [{recordId:'other'},{runId:'new-run'},{contentHash:'d'.repeat(64)}])assert.equal(reportCandidateMatchesRun(candidate(),{...run,...changed}),false);
});

test('re-read equality compares all eight fields, including exact body whitespace',()=>{
 const first=candidate();assert.equal(reportCandidatesEqual(first,structuredClone(first)),true);
 for(const field of ['recordId','runId','contentHash','sessionId','eventSeq','turn','text','candidateHash']){
  const changed={...first,[field]:typeof first[field]==='number'?first[field]+1:first[field]+' '};
  assert.equal(reportCandidatesEqual(first,changed),false,field);
 }
 assert.equal(reportCandidatesEqual(null,first),false);assert.equal(reportCandidatesEqual(first,null),false);
});

test('explicit append preserves original fields and complete candidate text, with a legal empty title',()=>{
 const original=Object.freeze(fields()),reply=Object.freeze(candidate()),before=structuredClone(original),replyBefore=structuredClone(reply);
 const result=appendReportAnalysisCandidate(original,reply,run);
 assert.notEqual(result,original);assert.equal(result.title,'');assert.equal(result.conclusion,original.conclusion);assert.equal(result.recommendations,original.recommendations);
 assert.equal(result.analysis,original.analysis+'\n\nAI 解读（待人工核对）\n'+reply.text);
 assert.deepEqual(original,before);assert.deepEqual(reply,replyBefore);
 assert.equal(appendReportAnalysisCandidate({...original,analysis:''},reply,run).analysis,'AI 解读（待人工核对）\n'+reply.text);
 assert.throws(()=>appendReportAnalysisCandidate(original,{...reply,runId:'old-run'},run),/candidate-scope-mismatch/);
});

test('invalid controls or surrogate text reject the whole proposal and leave the original intact',()=>{
 const original=fields(),before=structuredClone(original);
 for(const text of ['unsafe\u0000text','unsafe\u000btext','unsafe\u007ftext','unsafe\ud800text'])assert.throws(()=>appendReportAnalysisCandidate(original,{...candidate(),text},run));
 assert.throws(()=>appendReportAnalysisCandidate({...original,conclusion:'invalid\u0000conclusion'},candidate(),run));
 assert.deepEqual(original,before);
});

test('the full analysis field has an 8192 character boundary and never truncates',()=>{
 const original={...fields(),analysis:''},prefix='AI 解读（待人工核对）\n';
 const exact={...candidate(),text:'a'.repeat(8192-prefix.length)};
 assert.equal(appendReportAnalysisCandidate(original,exact,run).analysis.length,8192);
 assert.throws(()=>appendReportAnalysisCandidate(original,{...exact,text:exact.text+'a'},run));
 assert.throws(()=>appendReportAnalysisCandidate({...original,analysis:'已有文字'},exact,run));
 assert.equal(original.analysis,'');assert.equal(exact.text.length,8192-prefix.length);
});

test('total UTF-8 JSON budget includes the other fields and added label',()=>{
 const original={title:'',analysis:'',conclusion:'汉'.repeat(2000),recommendations:'字'.repeat(2000)};
 assert.ok(new TextEncoder().encode(JSON.stringify(original)).byteLength<12*1024);
 const before=structuredClone(original),reply={...candidate(),text:'数'.repeat(100)};
 assert.ok(reply.text.length<8192);
 assert.throws(()=>appendReportAnalysisCandidate(original,reply,run));
 assert.deepEqual(original,before);assert.equal(reply.text,'数'.repeat(100));
});
