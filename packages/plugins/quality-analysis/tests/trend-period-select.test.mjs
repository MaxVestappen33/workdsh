import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const feature=createRequire(new URL('../package.json',import.meta.url));
const web=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const React=feature('react');
// Evaluate the component's event-bearing element tree without a browser. The
// sizing/focus effects are inert here; installed UI acceptance covers the DOM.
const built=await web('esbuild').build({stdin:{contents:"export * from './QualityTrendChart';export * from './QualityResults';export * from '../domain/statistics';",resolveDir:fileURLToPath(new URL('../src/client/',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,
 plugins:[{name:'element-tree-hooks',setup(builder){
  builder.onResolve({filter:/^file:/},args=>({path:args.path,external:true}));
  builder.onResolve({filter:/^react$/},()=>({path:'hooks',namespace:'element-tree-hooks'}));
  builder.onLoad({filter:/.*/,namespace:'element-tree-hooks'},()=>({contents:`import React from ${JSON.stringify(pathToFileURL(feature.resolve('react')).href)}; export default React; export const useState=initial=>[typeof initial==='function'?initial():initial,()=>{}]; export const useRef=initial=>({current:initial}); export const useEffect=()=>{};`,loader:'js'}));
  builder.onResolve({filter:/^react\/jsx-runtime$/},args=>({path:pathToFileURL(feature.resolve(args.path)).href,external:true}));
 }}]});
const {QualityTrendChart,QualityResults,calculateQualityStatistics}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const elements=(node)=>{
 if(Array.isArray(node))return node.flatMap(elements);
 if(!React.isValidElement(node))return [];
 if(typeof node.type==='function')return elements(node.type(node.props));
 return [node,...elements(node.props.children)];
};
const rows=[{date:'2026-10-10',summary:{nonconformingRate:.076,inspectedQuantity:1000,nonconformingQuantity:76}},{date:'2026-10-11',summary:{nonconformingRate:.02,inspectedQuantity:1000,nonconformingQuantity:20}}];

test('trend point click and Enter/Space select the exact Host period while other keys do nothing',()=>{
 const selected=[],before=JSON.stringify(rows),tree=elements(QualityTrendChart({rows,onPeriodSelect:date=>selected.push(date),selectedPeriod:rows[0].date}));
 assert.equal(tree.find(node=>node.type==='svg').props.role,'group');
 const points=tree.filter(node=>node.type==='g'&&node.props.role==='button');assert.equal(points.length,2);
 assert.equal(points[0].props['aria-label'],'查看 2026-10-10 的检验记录');assert.equal(points[0].props.tabIndex,0);
 assert.equal(points[0].props['aria-pressed'],true);assert.equal(points[1].props['aria-pressed'],false);
 assert.ok(elements(points[0]).some(node=>node.type==='circle'&&node.props.r==='22'),'point target is 44 CSS pixels across');
 points[0].props.onClick();let prevented=0;
 for(const key of ['Enter',' ','ArrowRight'])points[1].props.onKeyDown({key,preventDefault(){prevented++;}});
 assert.deepEqual(selected,['2026-10-10','2026-10-11','2026-10-11']);assert.equal(prevented,2);
 assert.equal(JSON.stringify(rows),before,'selection never rewrites the Host statistics');
});

test('the report chart stays read-only when no period callback is supplied',()=>{
 const tree=elements(QualityTrendChart({rows,selectedPeriod:rows[0].date}));
 assert.equal(tree.find(node=>node.type==='svg').props.role,'img');
 assert.equal(tree.filter(node=>node.props.role==='button'||node.props.tabIndex!==undefined).length,0);
 assert.equal(tree.filter(node=>node.type==='circle').length,2);
});

test('recent-period and full-detail buttons reuse the exact weekly date and preserve weighted statistics',()=>{
 const statistics=calculateQualityStatistics({sourceNamespace:'fixed',complete:true,timeZone:'Asia/Shanghai',inspections:[{inspectionId:'A',inspectionDate:'2026-10-10',inspectedQuantity:300,nonconformingQuantity:6,quantityUnit:'piece',inspectionType:'initial'},{inspectionId:'B',inspectionDate:'2026-10-10',inspectedQuantity:700,nonconformingQuantity:70,quantityUnit:'piece',inspectionType:'initial'}],defects:[]},{trendGranularity:'week'});
 assert.equal(statistics.status,'complete');const before=JSON.stringify(statistics),date=statistics.trend[0].date,selected=[];
 const tree=elements(QualityResults({title:'质量概况',state:'ready',statistics,hasDefectSource:false,sourceDescription:'',selectedPeriod:date,onPeriodSelect:value=>selected.push(value)}));
 const buttons=tree.filter(node=>node.type==='button'&&node.props['aria-label']===`查看 ${date} 的检验记录`);
 assert.equal(buttons.length,2,'both recent periods and full details expose the same record entry');
 for(const button of buttons){assert.equal(button.props['aria-pressed'],true);assert.equal(button.props.style.minHeight,44);button.props.onClick();}
 assert.deepEqual(selected,[date,date]);assert.equal(JSON.stringify(statistics),before);
 assert.equal(statistics.summary.nonconformingRate,.076);
});

test('a missing-rate period remains a chart gap and can still be opened from result details',()=>{
 const statistics=calculateQualityStatistics({sourceNamespace:'fixed',complete:true,timeZone:'Asia/Shanghai',inspections:[{inspectionId:'ZERO',inspectionDate:'2026-10-10',inspectedQuantity:0,nonconformingQuantity:0,quantityUnit:'piece',inspectionType:'initial'}],defects:[]});
 const selected=[],tree=elements(QualityResults({title:'质量概况',state:'ready',statistics,hasDefectSource:false,sourceDescription:'',onPeriodSelect:date=>selected.push(date)}));
 assert.equal(tree.filter(node=>node.type==='g'&&node.props.role==='button').length,0);
 const button=tree.find(node=>node.type==='button'&&node.props['aria-label']==='查看 2026-10-10 的检验记录');assert.ok(button);button.props.onClick();assert.deepEqual(selected,['2026-10-10']);
});
