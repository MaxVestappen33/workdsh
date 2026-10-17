import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/source-checkpoints.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});const {parseSourceCheckpoints:parse,parseVerifiedSourceCheckpoint:receipt}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('checkpoint summaries reject private fields, forged verification, duplicates and budgets',()=>{
 const valid={sha256:'a'.repeat(64),fileCount:1,byteLength:3,verified:false};assert.deepEqual(parse([valid]),[valid]);assert.ok(Object.isFrozen(parse([valid])[0]));
 for(const item of [{...valid,path:'/private/source'},{...valid,verified:true},{...valid,byteLength:65*1024*1024},{...valid,fileCount:2001},{...valid,sha256:'bad'}])assert.throws(()=>parse([item]));assert.throws(()=>parse([valid,valid]));
});

test('verification receipt must match selected backup and contain no private fields',()=>{
 const valid={sha256:'a'.repeat(64),fileCount:1,byteLength:8,verified:true};assert.deepEqual(receipt(valid,valid.sha256),valid);assert.ok(Object.isFrozen(receipt(valid,valid.sha256)));
 for(const invalid of [{...valid,sha256:'b'.repeat(64)},{...valid,verified:false},{...valid,path:'/private'},{...valid,fileCount:-1}])assert.throws(()=>receipt(invalid,valid.sha256));
});
