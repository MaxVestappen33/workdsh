import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/runtime/analysis-executor.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { QualityAnalysisExecutor } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const headers=['id','date','total','bad','unit','type'];
const mapping={inspectionId:'id',inspectionDate:'date',inspectedQuantity:'total',nonconformingQuantity:'bad',quantityUnit:'unit',inspectionType:'type'};
const source=()=>({imported:{sha256:createHash('sha256').update('fixture').digest('hex'),table:{complete:true,encoding:'utf-8',byteLength:7,headers:[...headers],rows:[['001','2026/10/10','100','2','piece','初检']],locations:[{record:2,line:2}],ignoredBlankRecords:0}},mapping:{...mapping}});
const input=()=>({runId:'run1',createdAt:'2026-10-10T00:00:00Z',sourceNamespace:'fixture',inspections:source(),rules:{timeZone:'Asia/Shanghai',dateFormat:'yyyy/mm/dd',inspectionTypes:{初检:'initial'}}});
test('actual analysis worker executes cleaning, mapping, normalization and statistics',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'quality-analysis-worker-'));const path=join(dir,'worker.mjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/runtime/analysis-worker.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path});
 const executor=new QualityAnalysisExecutor(pathToFileURL(path));
 try{
 const request=input();request.inspections.imported.table.rows[0][2]='bad';
 request.inspections.decisions=[{kind:'correct',row:1,header:'total',expected:'bad',value:'100',reason:'核对原单'}];
 request.cleaningActor={principalId:'trusted-fixture',decidedAt:request.createdAt};
 const task=executor.execute(request);request.inspections.decisions[0].value='999';
 const result=await task;assert.equal(result.status,'complete');assert.equal(result.content.statistics.summary.inspectedQuantity,100);
 assert.equal(result.content.cleaning.inspections[0].value,'100');
 const invalid=input();invalid.inspections.imported.table.rows[0][2]='bad';
 assert.equal((await executor.execute(invalid)).status,'blocked');
 }finally{await executor.close();await rm(dir,{recursive:true,force:true});}
});
