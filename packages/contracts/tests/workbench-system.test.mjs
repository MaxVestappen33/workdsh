import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorkbenchSystemDefinition,resolveWorkbenchEditTarget} from '../dist/workbench-system.js';
const definition = () => ({schemaVersion:'1',modules:[{id:'data',title:'数据管理',pages:[{id:'sources',title:'数据来源'}],dependsOn:[]},{id:'analysis',title:'分析任务',pages:[{id:'runs',title:'分析记录'}],dependsOn:['data']}]});
test('system topology fixes module/page identity and isolates later source edits',()=>{
 const input=definition(),parsed=parseWorkbenchSystemDefinition(input); input.modules[0].pages[0].title='改写';
 assert.equal(parsed.modules[0].pages[0].title,'数据来源'); assert.equal(Object.isFrozen(parsed.modules[0].pages),true);
});
test('duplicate page identity and invalid module dependencies cannot become valid topology',()=>{
 for(const mutate of [d=>d.modules[1].pages[0].id='sources',d=>d.modules[1].id='data',d=>d.modules[1].dependsOn=['missing'],d=>d.modules[0].dependsOn=['data'],d=>d.modules[1].dependsOn=['data','data'],d=>d.modules[0].token='secret',d=>d.modules[0].pages=[]]){
  const d=definition();mutate(d);assert.throws(()=>parseWorkbenchSystemDefinition(d),/invalid-system-definition/);
 }
});

test('edit target belongs to selected module and conservatively includes transitive dependent modules',()=>{
 const d=definition();d.modules.push({id:'reports',title:'报告',pages:[{id:'report-page',title:'报告详情'}],dependsOn:['analysis']});
 assert.deepEqual(resolveWorkbenchEditTarget(d,{moduleId:'data',pageId:'sources'}).affectedModuleIds,['data','analysis','reports']);
 assert.deepEqual(resolveWorkbenchEditTarget(d,{moduleId:'reports'}).affectedModuleIds,['reports']);
 for(const target of [{moduleId:'data',pageId:'runs'},{moduleId:'missing'},{moduleId:'data',sourcePath:'/tmp/source'}])assert.throws(()=>resolveWorkbenchEditTarget(d,target),/invalid-edit-target/);
 d.modules[0].dependsOn=['reports'];
 assert.equal(resolveWorkbenchEditTarget(d,{moduleId:'data'}).affectedModuleIds.length,3);
});
