import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ stdin:{contents:"export * from './csv-import';export * from './library-source';export * from './analysis-run';export * from './report-library';",resolveDir:fileURLToPath(new URL('../src/runtime/',import.meta.url)),loader:'ts'}, bundle: true, platform: 'node', format: 'esm', write: false });
const { QualityCsvImporter,importQualityLibraryCsv,createQualityAnalysisRun,saveQualityReportToLibrary } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
test('real worker parses all bytes and hashes original BOM-containing file', async () => {
  const dir = await mkdtemp(join(tmpdir(),'quality-worker-'));
  const path = join(dir,'worker.mjs');
  await build({entryPoints:[fileURLToPath(new URL('../src/runtime/csv-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path});
  const importer = new QualityCsvImporter(pathToFileURL(path));
  try {
    const bytes = new TextEncoder().encode('\ufeffid,note\n0001,"a,b"');
    const task = importer.import(bytes); bytes.fill(0);
    const result = await task;
    assert.deepEqual(result.table.rows,[['0001','a,b']]);
    assert.equal(result.sha256,createHash('sha256').update('\ufeffid,note\n0001,"a,b"').digest('hex'));
    assert.equal(Object.isFrozen(result.table.rows[0]),true);
    await assert.rejects(importer.import(new Uint8Array([255])), error=>error.code==='invalid-utf8');
  } finally {await importer.close(); await rm(dir,{recursive:true,force:true});}
});
test('abort, timeout, concurrency and shutdown terminate actual workers', async () => {
  const dir=await mkdtemp(join(tmpdir(),'quality-worker-'));
  const path=join(dir,'waiting.mjs');
  // Deliberately stuck test worker to verify Host termination, not a parser substitute.
  await writeFile(path,'setInterval(()=>{},1000);');
  const importer=new QualityCsvImporter(pathToFileURL(path),1000);
  const controller=new AbortController();
  try {
    const a=importer.import(new Uint8Array(),controller.signal);
    const b=importer.import(new Uint8Array());
    const aCheck=assert.rejects(a,{name:'AbortError'});
    const bCheck=assert.rejects(b,error=>error.code==='closed');
    await assert.rejects(importer.import(new Uint8Array()),error=>error.code==='busy');
    controller.abort(); await aCheck;
    await importer.close(); await bCheck;
    await assert.rejects(importer.import(new Uint8Array()),error=>error.code==='closed');
    const timeout=new QualityCsvImporter(pathToFileURL(path),20);
    try {await assert.rejects(timeout.import(new Uint8Array()),error=>error.code==='timeout');} finally {await timeout.close();}
  } finally {await importer.close();await rm(dir,{recursive:true,force:true});}
});

test('library adapter binds exact revision and rejects late identity change',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'quality-library-source-'));const path=join(dir,'worker.mjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/runtime/csv-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path});
 const importer=new QualityCsvImporter(pathToFileURL(path));
 const actor={principalId:'fixture-member',organizationId:'org',resolvedBy:'fixture',requestId:'test'};
 let calls=[],active=true;
 // Library public-port fixture; authorization of a real library remains its owner.
 const library={async readOriginal(received,asset,revision){calls.push([received.principalId,asset,revision]);return new TextEncoder().encode('id\n0001');}};
 try{
 const reference={assetId:'asset1',revisionId:'revision-old'};
 const pending=importQualityLibraryCsv(library,importer,actor,reference,()=>{if(!active)throw new Error('revoked');});reference.revisionId='latest';
 const result=await pending;assert.deepEqual(calls,[['fixture-member','asset1','revision-old']]);assert.equal(result.provenance.revisionId,'revision-old');
 await assert.rejects(importQualityLibraryCsv(library,importer,actor,{assetId:'asset1',revisionId:''},()=>{}),/invalid-library-reference/);
 const revoking={async readOriginal(...args){const bytes=await library.readOriginal(...args);active=false;return bytes;}};
 await assert.rejects(importQualityLibraryCsv(revoking,importer,actor,{assetId:'asset1',revisionId:'r1'},()=>{if(!active)throw new Error('revoked');}),/revoked/);
 }finally{await importer.close();await rm(dir,{recursive:true,force:true});}
});

test('real LibraryManager supplies exact CSV bytes, rejects wrong revisions and disabled assets',async()=>{
 const runtimeRequire=createRequire(new URL('../../library/package.json',import.meta.url));
 const load=async name=>import(pathToFileURL(runtimeRequire.resolve(name)).href);
 const {Context}=await load('@deepseek-ai/cordis');const {default:Storage}=await load('@deepseek-ai/dsh-storage');
 const JsonStorage=await load('@deepseek-ai/dsh-storage-json');const StorageDomain=await load('@deepseek-ai/dsh-storage-domain');
 const {LibraryManager}=await import(new URL('../../library/dist/index.js',import.meta.url));
 const root=await mkdtemp(join(tmpdir(),'quality-real-library-'));const ctx=new Context();
 const worker=join(root,'worker.mjs');await build({entryPoints:[fileURLToPath(new URL('../src/runtime/csv-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:worker});
 const importer=new QualityCsvImporter(pathToFileURL(worker));
 const actor={principalId:'member',organizationId:'org',resolvedBy:'test',requestId:'test'};
 try{
 await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(root,'storage')});await ctx.plugin(StorageDomain,{backend:'json'});await ctx.plugin(LibraryManager,{root:join(root,'library')});
 const bytes=new TextEncoder().encode('id,date,total,bad,unit,type\n001,2026-10-10,100,2,piece,initial');
 const first=await ctx.workdshLibrary.importAsset(actor,{name:'inspection.csv',bytes,operationId:'first'});
 const second=await ctx.workdshLibrary.importAsset(actor,{name:'other.csv',bytes:new TextEncoder().encode('id,count\n002,200'),operationId:'second'});
 const result=await importQualityLibraryCsv(ctx.workdshLibrary,importer,actor,{assetId:first.asset.id,revisionId:first.revision.id},()=>{});
 assert.deepEqual(result.imported.table.rows,[['001','2026-10-10','100','2','piece','initial']]);assert.equal(result.imported.sha256,first.revision.originalSha256);
 await assert.rejects(importQualityLibraryCsv(ctx.workdshLibrary,importer,actor,{assetId:first.asset.id,revisionId:second.revision.id},()=>{}),/revision-asset-mismatch/);
 await assert.rejects(importQualityLibraryCsv(ctx.workdshLibrary,importer,{...actor,principalId:'other'},{assetId:first.asset.id,revisionId:first.revision.id},()=>{}),/not-found/);
 const run=createQualityAnalysisRun({runId:'library-run',createdAt:'2026-10-10T00:00:00Z',sourceNamespace:'library',rules:{timeZone:'UTC',dateFormat:'yyyy-mm-dd',inspectionTypes:{initial:'initial'}},inspections:{...result,mapping:{inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'}}});
 const receipt=await saveQualityReportToLibrary(ctx.workdshLibrary,actor,run,'质量报告',()=>{});
 const repeated=await saveQualityReportToLibrary(ctx.workdshLibrary,actor,run,'质量报告',()=>{});
 assert.deepEqual(receipt,repeated);
 const reportBytes=await ctx.workdshLibrary.readOriginal(actor,receipt.assetId,receipt.revisionId);
 assert.equal(createHash('sha256').update(reportBytes).digest('hex'),receipt.sha256);
 assert.ok(new TextDecoder().decode(reportBytes).includes(first.revision.id));
 assert.ok(new TextDecoder().decode(reportBytes).includes('2.00%'));
 await ctx.workdshLibrary.setAssetStatus(actor,first.asset.id,'disabled');
 await assert.rejects(importQualityLibraryCsv(ctx.workdshLibrary,importer,actor,{assetId:first.asset.id,revisionId:first.revision.id},()=>{}),/disabled/);
 }finally{await importer.close();await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
