import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const require=createRequire(new URL('../package.json',import.meta.url));const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await web('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/runtime/tool-schema-preflight.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,external:['typescript','@deepseek-ai/dsh-tools']});
const module={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);const{checkWorkbenchToolSchemas:check}=module.exports;
const source=(parameters)=>`import {defineTool as tool} from '@deepseek-ai/dsh-tools'; function mount(){tool({parameters:${parameters},execute(){throw Error('must never run')}})}`;
test('rejects the actual optional-parameter startup failure before importing a candidate',()=>{
 assert.throws(()=>check({'dist/index.js':source("{weekKey:{type:'string',required:false}}")}),/tool-optional-required-false/);
 assert.deepEqual(check({'dist/index.js':source("{weekKey:{type:'string'}}")}),{checked:1,unresolved:0,startup:'not-executed'});
});
test('uses official compiler for other schema errors and never executes candidate functions',()=>{
 assert.throws(()=>check({'index.js':source("{x:{type:'invented'}}")}),/tool-schema-invalid/);
 assert.deepEqual(check({'index.js':source("loadSchema()")}),{checked:0,unresolved:1,startup:'not-executed'});
 assert.equal(check({'index.js':source("{content:{type:'string',required:true}}")}).checked,1);
});
test('reads constant references and namespace imports without pretending dynamic definitions passed',()=>{
 const s="import * as Tools from '@deepseek-ai/dsh-tools';const params={x:{type:'string',required:false}};Tools.defineTool({parameters:params});";
 assert.throws(()=>check({'index.js':s}),/tool-optional-required-false/);
 assert.equal(check({'index.js':"import {defineTool} from '@deepseek-ai/dsh-tools';defineTool(makeDefinition());"}).unresolved,1);
});
