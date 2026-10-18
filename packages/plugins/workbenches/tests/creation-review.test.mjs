import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await web('esbuild').build({stdin:{contents:"export * from './creation-review.ts';export {createWorkbenchRequirementsClient} from './requirements-client.ts';",resolveDir:fileURLToPath(new URL('../src/client',import.meta.url))},bundle:true,platform:'node',format:'esm',write:false,alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))}});
const {creationProposalReview,restoreCreationReview,createWorkbenchRequirementsClient}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const draft={title:'旅行管家·实测',scenario:'管理多次旅行',users:'个人',dataSources:'手动录入',workflow:'旅行列表、行程、费用、待办',firstIteration:'新增和独立管理多次旅行',acceptance:'关闭重开数据保留'};
const creation={id:'creation',revision:'creation-revision',idea:'管理多次旅行',phase:'discussing',proposal:{...draft,title:'旅行管家·实测：多次旅行管理工作台'}};
const saved={id:'requirements-revision',developmentId:creation.id,owner:{organizationId:'personal',ownerPrincipalId:'member',scope:'personal'},createdBy:'member',createdAt:'2026-10-10T00:00:00.000Z',requirements:draft};
test('reopening uses validated saved edits instead of the older AI proposal without writing history',async()=>{
 const requests=[];
 const client=createWorkbenchRequirementsClient(undefined,async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json({ok:true,value:[saved]});});
 const proposal=creationProposalReview(creation),recovered=restoreCreationReview(creation,await client.history(creation.id),proposal);
 assert.equal(proposal.draft.title,creation.proposal.title);assert.equal(recovered.draft.title,'旅行管家·实测');
 assert.equal(recovered.revision,creation.revision);assert.notEqual(recovered.seed,proposal.seed);
 assert.deepEqual(requests,[{endpoint:'history',payload:{developmentId:creation.id}}]);
 assert.equal(creation.proposal.title,'旅行管家·实测：多次旅行管理工作台');
});
test('late recovery preserves an already edited or explicitly selected review and its conflict token',()=>{
 const chosen={revision:'previous-creation-revision',seed:'user-selection',draft:{...draft,title:'正在编辑的旅行名称'}};
 assert.equal(restoreCreationReview(creation,[saved],chosen,true),chosen);
 assert.equal(restoreCreationReview(creation,[],chosen),chosen);
 assert.equal(chosen.revision,'previous-creation-revision');
});
test('new discussions without saved requirements use the proposal, but foreign saved drafts are rejected',()=>{
 assert.deepEqual(restoreCreationReview(creation,[]),creationProposalReview(creation));
 assert.equal(restoreCreationReview({...creation,proposal:undefined},[]),undefined);
 assert.throws(()=>restoreCreationReview(creation,[{...saved,developmentId:'other-creation'}]),/workbench\/requirements-revision-conflict/);
});
