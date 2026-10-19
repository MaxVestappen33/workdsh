import type {QualityCleaningPage} from './cleaning-rows.js';
import type {QualityConfigurationView} from './configuration-view.js';
import type {QualityCleaningRequest} from '../runtime/configuration-request.js';
import type {createQualityRecordClient} from './record-client.js';
export type ReviewDecision=NonNullable<QualityCleaningRequest['inspections']>[number];
export type ReviewBlocked=Extract<Awaited<ReturnType<ReturnType<typeof createQualityRecordClient>['analyze']>>,{status:'blocked'}>;
export interface ReviewCheck {readonly sourceSnapshotId:string;readonly generation:number;readonly result:ReviewBlocked;}
export const qualityFieldNames:Readonly<Record<string,string>>={inspectionId:'检验编号',inspectionDate:'检验日期',inspectedQuantity:'检验数量',nonconformingQuantity:'不合格数量',quantityUnit:'数量单位',inspectionType:'检验类型',productId:'产品',batchId:'批次',lineId:'产线',defectId:'缺陷记录编号',defectCode:'缺陷代码',defectLabel:'缺陷名称',occurrences:'缺陷次数'};
export function reviewColumns(page:QualityCleaningPage,configuration:QualityConfigurationView){
 const mapping=page.tableKind==='inspections'?configuration.analysis.inspectionsMapping:configuration.analysis.defectsMapping??{};
 return Object.entries(mapping).map(([field,header])=>({field,header,index:page.headers.indexOf(header),label:qualityFieldNames[field]??header})).filter(column=>column.index>=0);
}
export function reviewValue(field:string,value:string|number|boolean|null,configuration:QualityConfigurationView):string{
 if(value===null||value==='')return '—';
 if(field==='quantityUnit'&&value==='piece')return '件';
 if(field==='inspectionType'){const mapped=configuration.analysis.rules.inspectionTypes[String(value)];if(mapped==='initial')return '初检';if(mapped==='retest')return '复检';}
 return String(value);
}
export function matchingReview(check:ReviewCheck|undefined,page:Pick<QualityCleaningPage,'sourceSnapshotId'|'generation'>):ReviewBlocked|undefined{
 return check?.sourceSnapshotId===page.sourceSnapshotId&&check.generation===page.generation?check.result:undefined;
}
export function reviewSourceMatches(page:QualityCleaningPage,configuration:QualityConfigurationView):boolean{
 const source=page.tableKind==='inspections'?configuration.inspections:configuration.defects;
 return page.recordId===configuration.recordId&&page.generation===configuration.generation&&page.sourceSnapshotId===configuration.sourceSnapshotId&&!!source&&JSON.stringify(page.headers)===JSON.stringify(source.headers);
}
export function reviewVisibleRows(page:QualityCleaningPage,decisions:readonly ReviewDecision[],check:ReviewCheck|undefined,filter:'all'|'issues'|'reviewed',query:string){
 const issues=matchingReview(check,page)?.issues.filter(issue=>issue.table===page.tableKind)??[],search=query.trim().toLocaleLowerCase();
 return page.rows.filter(row=>(filter!=='issues'||issues.some(issue=>issue.row===row.row))&&(filter!=='reviewed'||decisions.some(item=>item.row===row.row))&&(!search||row.values.some(cell=>String(cell??'').toLocaleLowerCase().includes(search))));
}
export interface ReviewForm {readonly kind:'correct'|'exclude';readonly header:string;readonly value:string;readonly reason:string;}
export interface ReviewFormScope {readonly recordId:string;readonly sourceSnapshotId:string;readonly generation:number;readonly tableKind:'inspections'|'defects';readonly row:number;}
export interface ReviewFormBaseline {readonly scope:ReviewFormScope;readonly form:ReviewForm;}
/** Inputs in the row editor are separate from submitted analysis decisions. */
export function reviewFormChanged(base:ReviewFormBaseline|undefined,scope:ReviewFormScope|undefined,form:ReviewForm):boolean{
 if(!base||!scope||Object.entries(base.scope).some(([key,value])=>scope[key as keyof ReviewFormScope]!==value))return false;
 return (['kind','header','value','reason'] as const).some(key=>base.form[key]!==form[key]);
}
const messages:Readonly<Record<string,string>>={
 'invalid-integer':'请输入有效的非负整数。','invalid-date':'日期无效，请核对源表日期和已选择的日期格式。','unmapped-inspection-type':'该检验类型尚未对应初检或复检，请检查字段规则。',
 'invalid-inspection':'检验记录不符合规则，请核对日期、数量、单位和检验类型。','duplicate-inspection-id':'检验编号重复，请核对是否重复导入或填写。','invalid-defect':'缺陷记录不符合规则，请核对编号、名称及次数。',
 'duplicate-defect-id':'缺陷记录编号重复。','orphan-defect':'找不到对应的检验记录，请核对关联编号。','conflicting-defect-label':'同一缺陷代码对应了不同名称。',
 'mixed-quantity-units':'数据包含不同计量单位，不能直接合并统计。','retest-policy-required':'包含复检数据，请先明确复检统计规则。','invalid-filter':'分析范围或筛选规则无效，请检查配置。',
 'incomplete-source':'数据来源不完整，请重新导入完整文件。','source-namespace-mismatch':'记录来源与本次分析不一致。','invalid-source-namespace':'数据来源标识无效。','invalid-time-zone':'业务时区无效，请检查配置。',
 'row-budget-exceeded':'记录数量超过本次分析支持的范围。','quantity-overflow':'数量合计超出支持范围，请核对原数据。','period-out-of-range':'日期超出趋势统计支持的范围。','invalid-tables':'数据表结构无效，请重新导入。',
};
export function reviewIssueMessage(issue:{code:string;field?:string}):string{
 const field=issue.field&&Object.hasOwn(qualityFieldNames,issue.field)?qualityFieldNames[issue.field]:undefined;
 return `${field?`${field}：`:''}${Object.hasOwn(messages,issue.code)?messages[issue.code]:'该记录未通过校验，请查看问题详情并核对原数据。'}`;
}
export function replaceReviewDecision(current:readonly ReviewDecision[],next:ReviewDecision):ReviewDecision[]{
 if(!next.reason.trim())throw Error('请填写核对说明。');
 if(current.some(item=>item.row===next.row&&item.kind!==next.kind))throw Error('这条记录已有其他处理方式，请先撤销原决定。');
 const remaining=current.filter(item=>!(item.row===next.row&&(next.kind==='exclude'||item.kind==='correct'&&next.kind==='correct'&&item.header===next.header)));
 if(remaining.length>=100)throw Error('每张表本轮最多保存 100 项决定，请分批处理或修改源表。');
 return [...remaining,next];
}
