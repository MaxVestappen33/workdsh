import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url));
const {build} = require('esbuild');
const result = await build({entryPoints:[fileURLToPath(new URL('../src/client/library-choice.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {qualityLibraryChoice} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('quality selection fixes asset and revision and rejects unsupported or inconsistent entries',()=>{
 const row={kind:'asset',name:'检验数据',assetId:'a',asset:{id:'a',kind:'csv',status:'active'},revision:{id:'r-old',assetId:'a'}};
 const choice=qualityLibraryChoice(row);
 assert.deepEqual(choice,{assetId:'a',revisionId:'r-old',title:'检验数据',format:'csv'});
 assert.ok(Object.isFrozen(choice));
 row.revision.id='r-new'; assert.equal(choice.revisionId,'r-old');
 for(const invalid of [{...row,kind:'folder'},{...row,assetId:'other'},{...row,asset:{...row.asset,status:'disabled'}},{...row,asset:{...row.asset,kind:'pdf'}},{...row,revision:{id:'r',assetId:'other'}},{...row,revision:undefined}])assert.equal(qualityLibraryChoice(invalid),undefined);
 assert.equal(qualityLibraryChoice({...row,asset:{...row.asset,kind:'xlsx'}}).format,'xlsx');
});
