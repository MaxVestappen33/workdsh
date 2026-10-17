import { verifyQualityAnalysisRunHash, type CompleteQualityAnalysisRun } from './analysis-run';
const escape = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#!|]/g,'\\$&');
const rate = (value: number | null) => value === null ? '不可计算（分母为零）' : (value * 100).toFixed(2) + '%';

/** Deterministic Markdown from a fixed run, no AI conclusions or live config. */
export function renderQualityMarkdownReport(run: CompleteQualityAnalysisRun, recordTitle: string): string {
  if (!recordTitle.trim() || recordTitle.length > 256 || !verifyQualityAnalysisRunHash(run)) throw new Error('quality/report/invalid-run');
  const {statistics:s,filter, sources,cleaning,rules}=run.content;
  const lines = [`# ${escape(recordTitle)} — 质量分析报告`, '',
    `分析运行：${escape(run.runId)}；创建时间：${escape(run.createdAt)}。`,
    `内容 SHA-256：${run.contentHash}。`, '', '## 数据来源与范围', '',
    run.content.projectContext ? `分析时项目：${escape(run.content.projectContext.projectName)}（${escape(run.content.projectContext.projectId)}）；配置版本：${escape(run.content.projectContext.configRevisionId)}。` : '本次分析未关联项目。',
    `来源命名空间：${escape(s.sourceNamespace)}；业务时区：${escape(s.timeZone)}。`,
    `检验原文件 SHA-256：${sources.inspections.imported.sha256}；原始数据 ${sources.inspections.imported.table.rows.length} 行。`,
    ...(sources.inspections.format ? [`检验工作表：${escape(sources.inspections.format.worksheet)}；表头行：${sources.inspections.format.headerRow}；读取策略：${escape(sources.inspections.format.valuePolicy)}。`] : []),
    sources.inspections.provenance ? `检验资料资产：${escape(sources.inspections.provenance.assetId)}；固定版本：${escape(sources.inspections.provenance.revisionId)}。` : '检验来源未关联资料库版本。',
    sources.defects ? `缺陷原文件 SHA-256：${sources.defects.imported.sha256}；原始数据 ${sources.defects.imported.table.rows.length} 行。` : '未提供缺陷明细；缺陷图表仅表示已提供数据，不代表企业实际缺陷为零。',
    ...(sources.defects?.provenance ? [`缺陷资料资产：${escape(sources.defects.provenance.assetId)}；固定版本：${escape(sources.defects.provenance.revisionId)}。`] : []),
    `日期范围：${escape(filter.dateFrom ?? '不限')} 至 ${escape(filter.dateTo ?? '不限')}。`,
    `产品筛选：${filter.productIds === undefined ? '不限' : filter.productIds.length ? filter.productIds.map(escape).join('、') : '空选择'}；产线筛选：${filter.lineIds === undefined ? '不限' : filter.lineIds.length ? filter.lineIds.map(escape).join('、') : '空选择'}。`,
    `复检策略：${filter.retestPolicy === 'exclude' ? '排除复检' : filter.retestPolicy === 'include-separately' ? '复检作为独立检验计入' : '当前范围未包含复检'}；日期格式：${rules.dateFormat}。`, '',
    '## 统计口径与汇总', '', '不合格率 = 不合格数量合计 ÷ 检验数量合计。缺陷次数独立累计，不重复计算检验分母；多个缺陷可对应同一不合格件。', '',
    '| 指标 | 结果 |','| --- | --- |',
    `| 检验记录 | ${s.summary.inspectionCount} |`, `| 检验数量 | ${s.summary.inspectedQuantity} |`,
    `| 不合格数量 | ${s.summary.nonconformingQuantity} |`, `| 合格数量 | ${s.summary.conformingQuantity} |`,
    `| 不合格率 | ${rate(s.summary.nonconformingRate)} |`,
    `| 已提供缺陷次数 | ${sources.defects ? s.summary.defectOccurrences : '未提供明细'} |`,
    `| 数量单位 | ${escape(s.quantityUnit ?? '当前范围无记录')} |`, '',
    `## ${{day:'日',week:'周',month:'月'}[s.trendGranularity??'day']}趋势`, '', s.trendGranularity==='week'?'周期以业务日期所在周的周一开始；筛选边界内的数据参与计算。':s.trendGranularity==='month'?'周期以业务日期所在月的首日开始；筛选边界内的数据参与计算。':'按业务日期分组。', '', '| 周期起始日期 | 检验数量 | 不合格数量 | 不合格率 |','| --- | --- | --- | --- |',
    ...s.trend.map(row=>`| ${row.date} | ${row.summary.inspectedQuantity} | ${row.summary.nonconformingQuantity} | ${rate(row.summary.nonconformingRate)} |`), '',
    '## 缺陷分布', '', '| 缺陷 | 次数 | 累计比例 |','| --- | --- | --- |',
    ...s.pareto.map(row=>`| ${escape(row.defectLabel)}（${escape(row.defectCode)}） | ${row.occurrences} | ${rate(row.cumulativeRate)} |`), '',
    '## 校验与清洗', '', '本运行已通过映射、标准化及统计校验；原始数据随快照保留。', '',
    '| 数据表 | 原记录 / 起始行 | 操作 | 原因 | 操作人 / 时间 |','| --- | --- | --- | --- | --- |'];
  for (const [table, decisions] of Object.entries(cleaning)) for (const decision of decisions) {
    const action=decision.kind==='exclude'?'排除':`修正 ${decision.header}：${decision.expected} → ${decision.value}`;
    lines.push(`| ${table==='inspections'?'检验':'缺陷'} | ${decision.location.record} / ${decision.location.line} | ${escape(action)} | ${escape(decision.reason)} | ${escape(decision.actor.principalId)} / ${escape(decision.actor.decidedAt)} |`);
  }
  if (!cleaning.inspections.length && !cleaning.defects.length) lines.push('未执行人工修正或排除。');
  lines.push('', '本报告描述当前数据的统计结果，不推断异常原因。未进行 AI 解读。', '');
  return lines.join('\n');
}
