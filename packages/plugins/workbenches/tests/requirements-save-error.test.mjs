import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const built=await require('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/client/requirements-save-error.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {requirementsSaveFailureMessage}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
test('partial confirmation never tells the user saved requirements were lost',()=>{
 const message=requirementsSaveFailureMessage({code:'workbench/sdk-package-unavailable',requirementsSaved:true,preparationStage:'source'});
 assert.match(message,/需求已保存/);assert.match(message,/SDK/);assert.doesNotMatch(message,/未保存成功/);
 assert.match(requirementsSaveFailureMessage({code:'workbench/unexpected',requirementsSaved:true,preparationStage:'session'}),/会话尚未关联/);
 assert.doesNotMatch(requirementsSaveFailureMessage(Error('/private/unsafe')),/private/);
});
