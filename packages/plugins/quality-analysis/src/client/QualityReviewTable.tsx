import React from 'react';
import type {QualityCleaningPage} from './cleaning-rows.js';
import type {QualityConfigurationView} from './configuration-view.js';
import {matchingReview,reviewColumns,reviewSourceMatches,reviewValue,reviewVisibleRows,type ReviewCheck,type ReviewDecision} from './review-presentation.js';
export function QualityReviewTable({page,configuration,decisions,check,filter,query,busy,onOpen}:{
 page:QualityCleaningPage;configuration:QualityConfigurationView;decisions:readonly ReviewDecision[];check?:ReviewCheck;
 filter:'all'|'issues'|'reviewed';query:string;busy:boolean;onOpen:(row:QualityCleaningPage['rows'][number])=>void;
}){
 if(!reviewSourceMatches(page,configuration))return <p role="alert">数据与字段配置已变化，请刷新后核对。</p>;
 const columns=reviewColumns(page,configuration),issues=matchingReview(check,page)?.issues.filter(issue=>issue.table===page.tableKind)??[];
 const rows=reviewVisibleRows(page,decisions,check,filter,query);
 return <div className="wd-quality-review-table"><table><thead><tr>{columns.map(column=><th key={column.header}>{column.label}</th>)}<th>核对状态</th><th>操作</th></tr></thead><tbody>{rows.map(row=>{
  const current=decisions.filter(item=>item.row===row.row),hasIssue=issues.some(issue=>issue.row===row.row),status=current.some(item=>item.kind==='exclude')?'待应用排除':current.length?'待应用修正':hasIssue?'有校验问题':'—';
  return <tr key={row.row}>{columns.map(column=><td key={column.header} className={['inspectedQuantity','nonconformingQuantity','occurrences'].includes(column.field)?'wd-quality-number':undefined}>{reviewValue(column.field,row.values[column.index],configuration)}</td>)}<td><span className={`wd-quality-review-state ${hasIssue&&!current.length?'wd-quality-review-state-warning':''}`}>{status}</span></td><td><button disabled={busy} onClick={()=>onOpen(row)}>{hasIssue?'处理':'查看'}</button></td></tr>;
 })}</tbody></table>{rows.length===0&&<p className="wd-quality-review-empty">{page.total===0?'此来源没有记录。':'本页没有符合条件的记录。'}</p>}</div>;
}
