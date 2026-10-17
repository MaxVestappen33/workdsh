import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {build}=createRequire(new URL('../../../../apps/web/package.json',import.meta.url))('esbuild');
const built=await build({entryPoints:[fileURLToPath(new URL('../src/client/run-view.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {parseQualityRunView:parse}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const hash='a'.repeat(64);
const report={runId:'run',contentHash:hash,sha256:'b'.repeat(64),operationId:'op',assetId:'asset',revisionId:'revision',nodeId:'node',format:'markdown',detailKind:'markdown'};
const view={recordId:'record',runId:'run',contentHash:hash,createdAt:'2026-10-10T00:00:00Z',hasDefectSource:false,reports:[report],statistics:{status:'complete',sourceNamespace:'source',timeZone:'Asia/Shanghai',quantityUnit:null,summary:{inspectionCount:0,inspectedQuantity:0,nonconformingQuantity:0,conformingQuantity:0,nonconformingRate:null,defectOccurrences:0},includedInspectionIds:[],trend:[],products:[],pareto:[]}};
const read=value=>parse(value,'record','run',hash,false);
test('saved report receipts restore with their exact run and immutable identities',()=>{
 const parsed=read(view);assert.deepEqual(parsed.reports,[report]);assert.equal(Object.isFrozen(parsed.reports[0]),true);
 assert.equal(read({...view,reports:undefined}).reports,undefined);
});
test('foreign, duplicate, malformed and over-budget report receipts are rejected',()=>{
 for(const reports of [[{...report,runId:'other'}],[{...report,contentHash:'c'.repeat(64)}],[report,report],[{...report,assetId:''}],[{...report,token:'secret'}],[{...report,format:'csv'}],Array(1001).fill(report)])assert.throws(()=>read({...view,reports}),/response\/invalid/);
});
