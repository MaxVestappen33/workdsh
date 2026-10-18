import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const webRequire=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const runtimeRequire=createRequire(new URL('../../projects/package.json',import.meta.url));
const {build}=webRequire('esbuild');
const built=await build({stdin:{contents:"export * from '../client/run-view';export * from './analysis-run';export * from './run-service';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,
 alias:{'workdsh-contracts':fileURLToPath(new URL('../../../contracts/src/index.ts',import.meta.url))},
 plugins:[{name:'official-storage',setup(builder){builder.onResolve({filter:/^(?:@deepseek-ai\/dsh-storage-domain|zod)$/},args=>({path:pathToFileURL(runtimeRequire.resolve(args.path)).href,external:true}));}}]});
const {parseQualityRunView,createQualityAnalysisRun,QualityAnalysisRunService}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const load=name=>import(pathToFileURL(runtimeRequire.resolve(name)).href);
const {Context}=await load('@deepseek-ai/cordis');
const {default:Storage}=await load('@deepseek-ai/dsh-storage');
const JsonStorage=await load('@deepseek-ai/dsh-storage-json');
const StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
const actor={principalId:'basis-fixture',organizationId:'org-fixture',requestId:'basis-test',resolvedBy:'trusted-fixture'};
const identity={async resolve(){return {...actor};},profile(){return {principalId:actor.principalId,organization:{id:actor.organizationId},resolvedBy:actor.resolvedBy};},membership(){return {state:'active'};}};
async function boot(root){const ctx=new Context();await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(StorageDomain,{backend:'json'});return ctx;}
const mapping={inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type',productId:'product',lineId:'line'};
const table=(headers,rows)=>({complete:true,byteLength:100,headers,rows,locations:rows.map((_,index)=>({record:index+4,line:index+4}))});
function fixture(runId='saved-run'){
 return createQualityAnalysisRun({runId,createdAt:'2026-10-10T00:00:00Z',sourceNamespace:'original-source',cleaningActor:{principalId:actor.principalId,decidedAt:'2026-10-10T00:00:00Z'},
  rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial'},extraCredential:'SHOULD_NOT_BE_PROJECTED'},
  filter:{productIds:['P1'],lineIds:['L1'],dateFrom:'2026-10-10',dateTo:'2026-10-12',retestPolicy:'exclude',trendGranularity:'day',extraCredential:'SHOULD_NOT_BE_PROJECTED'},
  inspections:{mapping,imported:{sha256:'a'.repeat(64),table:table([...Object.values(mapping),'internal_note'],[
   ['INS-1','2026/10/10','100','8','piece','初检','P1','L1','RAW_ONLY_FIXTURE'],
   ['INS-2','2026/10/11','200','10','piece','初检','P2','L1','RAW_ONLY_FIXTURE'],
   ['INS-3','2026/10/12','100','1','piece','初检','P1','L2','RAW_ONLY_FIXTURE']])},
   format:{kind:'xlsx',worksheet:'检验记录',headerRow:3,valuePolicy:'cached-values',extraCredential:'SHOULD_NOT_BE_PROJECTED'},
   provenance:{kind:'library',assetId:'original-asset',revisionId:'original-revision',extraCredential:'SHOULD_NOT_BE_PROJECTED'},
   decisions:[{kind:'correct',row:1,header:'bad',expected:'8',value:'5',reason:'REASON_ONLY_FIXTURE'},{kind:'exclude',row:2,reason:'REASON_ONLY_FIXTURE'}]},
  defects:{mapping:{defectId:'defect',inspectionId:'inspection',defectCode:'code',defectLabel:'label',occurrences:'occurrences'},
   imported:{sha256:'b'.repeat(64),table:table(['defect','inspection','code','label','occurrences'],[['D1','INS-1','SCRATCH','划伤','4'],['D2','INS-2','SCRATCH','划伤','2']])},
   provenance:{kind:'library',assetId:'defect-asset',revisionId:'defect-revision'},
   decisions:[{kind:'correct',row:1,header:'occurrences',expected:'4',value:'5',reason:'REASON_ONLY_FIXTURE'},{kind:'exclude',row:2,reason:'REASON_ONLY_FIXTURE'}]}});
}
function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';}
function oldRun(){const saved=structuredClone(fixture('old-run'));saved.content.algorithmVersion='quality-statistics/1';delete saved.content.cleaning;delete saved.content.transformations;delete saved.content.statistics.trendGranularity;delete saved.content.filter.trendGranularity;saved.contentHash=createHash('sha256').update(canonical(saved.content)).digest('hex');return saved;}
const parse=view=>parseQualityRunView(view,view.recordId,view.runId,view.contentHash,false);

test('run basis restores immutable source, mappings, rules, filters and reviewed counts after configuration changes and a cold restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-run-basis-'));let ctx,service;
 try{
  ctx=await boot(root);service=new QualityAnalysisRunService(ctx.storageDomain,identity);
  const record=await service.createRecord('质量分析','create-basis-fixture');const saved=fixture();assert.equal(saved.status,'complete');
  await service.appendHostRun(record.id,saved,0);
  const view=await service.readRunView(record.id,saved.runId,saved.contentHash,false),parsed=parse(view);
  assert.equal(parsed.basis.sourceNamespace,'original-source');assert.equal(parsed.basis.algorithmVersion,'quality-statistics/2');
  assert.deepEqual(parsed.basis.sources.inspections,{sha256:'a'.repeat(64),rowCount:3,mapping,format:{kind:'xlsx',worksheet:'检验记录',headerRow:3,valuePolicy:'cached-values'},provenance:{kind:'library',assetId:'original-asset',revisionId:'original-revision'}});
  assert.deepEqual(parsed.basis.review,{inspections:{correctedRows:1,correctedCells:1,excludedRows:1,normalizationChanges:4},defects:{correctedRows:1,correctedCells:1,excludedRows:1,normalizationChanges:0}});
  assert.deepEqual(parsed.basis.rules,{timeZone:'Asia/Shanghai',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial'}});
  assert.deepEqual(parsed.basis.filter,{productIds:['P1'],lineIds:['L1'],dateFrom:'2026-10-10',dateTo:'2026-10-12',retestPolicy:'exclude',trendGranularity:'day'});
  assert.equal(parsed.statistics.summary.inspectedQuantity,100);assert.equal(parsed.statistics.summary.nonconformingQuantity,5);
  assert.equal(Object.isFrozen(parsed.basis.sources.inspections.mapping),true);assert.equal(Object.isFrozen(parsed.basis.review.inspections),true);
  const publicJson=JSON.stringify(view);for(const hidden of ['RAW_ONLY_FIXTURE','REASON_ONLY_FIXTURE','SHOULD_NOT_BE_PROJECTED','decisions','dataset','transformations','cleaningActor'])assert.equal(publicJson.includes(hidden),false);
  view.basis.sources.inspections.mapping.inspectionId='changed';assert.equal((await service.readRunView(record.id,saved.runId,saved.contentHash,false)).basis.sources.inspections.mapping.inspectionId,'id');
  await service.configure(record.id,{title:'新的分析配置',sourceNamespace:'different-current-source',timeZone:'UTC',mappingRevision:'different-mapping',sourceSnapshotId:'different-source'},0);
  assert.deepEqual(parse(await service.readRunView(record.id,saved.runId,saved.contentHash,false)).basis,parsed.basis);
  await service.close();await ctx.fiber.dispose();ctx=await boot(root);service=new QualityAnalysisRunService(ctx.storageDomain,identity);
  assert.deepEqual(parse(await service.readRunView(record.id,saved.runId,saved.contentHash,false)).basis,parsed.basis);
 }finally{await service?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('legacy saved runs with missing audit arrays return unknown counts without reading the current configuration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-old-basis-'));let ctx,service;
 try{ctx=await boot(root);service=new QualityAnalysisRunService(ctx.storageDomain,identity);const record=await service.createRecord('历史记录','create-old-basis');const saved=oldRun();
  await service.appendHostRun(record.id,saved,0);const view=await service.readRunView(record.id,saved.runId,saved.contentHash,false);
  assert.deepEqual(parse(view).basis.review,{inspections:{correctedRows:null,correctedCells:null,excludedRows:null,normalizationChanges:null},defects:{correctedRows:null,correctedCells:null,excludedRows:null,normalizationChanges:null}});
  assert.equal(view.basis.algorithmVersion,'quality-statistics/1');const {basis,...oldResponse}=view;assert.equal(parse(oldResponse).basis,undefined);
 }finally{await service?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('basis parser rejects raw rows, credentials, invalid dates/enums, cross-source state and invalid review counts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-basis-parser-'));let ctx,service;
 try{ctx=await boot(root);service=new QualityAnalysisRunService(ctx.storageDomain,identity);const record=await service.createRecord('核查响应','create-parser-basis'),saved=fixture();await service.appendHostRun(record.id,saved,0);const original=await service.readRunView(record.id,saved.runId,saved.contentHash,false);
  const mutations=[
   view=>{view.basis.sources.inspections.rows=[['raw']];},view=>{view.basis.sources.inspections.provenance.token='credential';},view=>{view.basis.rules.token='credential';},
   view=>{view.basis.filter.dateFrom='2026-02-30';},view=>{view.basis.filter.dateFrom='2026-10-13';},view=>{view.basis.filter.dateTo='2026-10-09';},
   view=>{view.basis.filter.retestPolicy='automatic';},view=>{view.basis.filter.trendGranularity='year';},view=>{view.basis.filter.trendGranularity='week';},view=>{view.basis.filter.lineIds=[''];},
   view=>{view.basis.rules.dateFormat='automatic';},view=>{view.basis.rules.inspectionTypes.初检='anything';},view=>{view.basis.rules.timeZone='UTC';},
   view=>{view.basis.sourceNamespace='different-current-source';},view=>{delete view.basis.sources.defects;},view=>{delete view.basis.review.defects;},
   view=>{view.basis.sources.inspections.sha256='not-a-hash';},view=>{view.basis.sources.inspections.rowCount=10001;},view=>{view.basis.sources.inspections.mapping.token='credential';},
   view=>{delete view.basis.sources.inspections.mapping.inspectionId;},view=>{view.basis.sources.inspections.format.headerRow=0;},
   view=>{view.basis.review.inspections.correctedCells=0;},view=>{view.basis.review.inspections.excludedRows=3;},view=>{view.basis.review.inspections.normalizationChanges=-1;},
   view=>{view.basis.review.inspections.correctedRows=null;},view=>{view.basis.sources.inspections.mapping.inspectionId='x'.repeat(256*1024);},
  ];
  for(const mutate of mutations){const value=structuredClone(original);mutate(value);assert.throws(()=>parse(value),/quality\/response\/invalid/);}
 }finally{await service?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('Host rejects an over-budget basis projection instead of truncating historical mapping metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quality-basis-budget-'));let ctx,service;
 try{ctx=await boot(root);service=new QualityAnalysisRunService(ctx.storageDomain,identity);const record=await service.createRecord('大表头','create-budget-basis'),saved=structuredClone(fixture());
  for(const [field,header] of Object.entries(saved.content.sources.inspections.mapping)){const long=header+'x'.repeat(40000);saved.content.sources.inspections.imported.table.headers[saved.content.sources.inspections.imported.table.headers.indexOf(header)]=long;saved.content.sources.inspections.mapping[field]=long;}
  saved.contentHash=createHash('sha256').update(canonical(saved.content)).digest('hex');await service.appendHostRun(record.id,saved,0);
  await assert.rejects(service.readRunView(record.id,saved.runId,saved.contentHash,false),/run-basis-budget-exceeded/);
 }finally{await service?.close();await ctx?.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
