import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const { build } = require('esbuild');
const built = await build({ entryPoints: [fileURLToPath(new URL('../src/domain/cleaning.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { cleanQualityTable } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const table=()=>({complete:true,encoding:'utf-8',byteLength:10,headers:['id','quantity'],rows:[['001','bad'],['002','20']],locations:[{record:3,line:3},{record:4,line:5}],ignoredBlankRecords:1});
const actor={principalId:'host-principal',decidedAt:'2026-10-10T00:00:00Z'};
const correction={kind:'correct',row:1,header:'quantity',expected:'bad',value:'10',reason:'核对原单'};
test('correction and exclusion preserve original values, actor and source locations',()=>{
 const source=table();const result=cleanQualityTable(source,[correction,{kind:'exclude',row:2,reason:'非本次范围'}],actor);
 assert.deepEqual(result.table.rows,[['001','10']]);assert.deepEqual(source.rows,[['001','bad'],['002','20']]);
 assert.equal(result.excludedCount,1);assert.deepEqual(result.audit[0].location,{record:3,line:3});
 assert.equal(result.audit[0].actor.principalId,'host-principal');assert.equal(Object.isFrozen(result.audit[0]),true);
});
test('stale values, duplicate edits and correction/exclusion conflicts fail',()=>{
 for(const decisions of [[{...correction,expected:'old'}],[correction,correction],[correction,{kind:'exclude',row:1,reason:'x'}],[{kind:'exclude',row:1,reason:'x'},correction],[{...correction,reason:''}],[{...correction,row:0}]]) assert.throws(()=>cleanQualityTable(table(),decisions,actor));
});
