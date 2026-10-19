import React from 'react';

type ReportBlock={readonly kind:'paragraph';readonly text:string}|{readonly kind:'table';readonly headings:readonly string[];readonly rows:readonly (readonly string[])[]};
interface ReportSection {readonly heading?:string;readonly level:number;readonly blocks:readonly ReportBlock[];}
const border='var(--dsw-alias-border-l2, #dce2e9)';
const secondary='var(--dsw-alias-label-secondary, #657185)';
const literal=(value:string)=>value.replace(/\\([\\`*_{}\[\]()#!|])/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function tableCells(line:string):string[]{
 const cells:string[]=[],body=line.trim().replace(/^\|/,'').replace(/\|$/,'');let cell='',escaped=false;
 for(const char of body){if(char==='|'&&!escaped){cells.push(literal(cell.trim()));cell='';}else cell+=char;escaped=char==='\\'&&!escaped;}
 cells.push(literal(cell.trim()));return cells;
}
/** Only the read-only Markdown structures emitted by the quality report are
 * presented. Unknown text stays literal; HTML, links and scripts are not run. */
export function qualityReportSections(markdown:string):readonly ReportSection[]{
 const lines=markdown.split(/\r?\n/),sections:{heading?:string;level:number;blocks:ReportBlock[]}[]=[{level:0,blocks:[]}];
 for(let index=0;index<lines.length;index++){
  const line=lines[index],heading=/^(#{1,3})\s+(.+)$/.exec(line);
  if(heading){sections.push({heading:literal(heading[2]),level:heading[1].length,blocks:[]});continue;}
  if(!line.trim())continue;
  const section=sections[sections.length-1];
  if(line.trim().startsWith('|')&&/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index+1]??'')){
   const headings=tableCells(line),rows:string[][]=[];index++;
   while(lines[index+1]?.trim().startsWith('|'))rows.push(tableCells(lines[++index]));
   section.blocks.push({kind:'table',headings,rows});
  }else section.blocks.push({kind:'paragraph',text:literal(line)});
 }
 return sections.filter(section=>section.heading||section.blocks.length);
}
function Blocks({blocks}:{blocks:readonly ReportBlock[]}){
 return <>{blocks.map((block,index)=>block.kind==='paragraph'?<p key={index} style={{margin:'10px 0',lineHeight:1.8,overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{block.text}</p>:<div key={index} style={{overflowX:'auto',margin:'14px 0'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13,textAlign:'left'}}><thead><tr>{block.headings.map((heading,column)=><th key={column} scope="col" style={{padding:'9px 12px',borderBottom:`1px solid ${border}`,fontWeight:550,color:secondary}}>{heading}</th>)}</tr></thead><tbody>{block.rows.map((row,record)=><tr key={record}>{row.map((value,column)=><td key={column} style={{padding:'9px 12px',borderBottom:`1px solid ${border}`,overflowWrap:'anywhere',fontVariantNumeric:'tabular-nums'}}>{value}</td>)}</tr>)}</tbody></table></div>)}</>;
}
export function QualityReportDocument({markdown}:{markdown:string}){
 return <article aria-label="报告正文" className="wd-quality-report-document" style={{minWidth:0}}>{qualityReportSections(markdown).map((section,index)=>{
  if(section.heading==='数据来源与范围'||section.heading==='校验与清洗'){
   const footer=section.blocks.filter(block=>block.kind==='paragraph'&&block.text.startsWith('本报告描述当前数据的统计结果'));
   return <React.Fragment key={index}><details className="wd-quality-report-evidence" style={{margin:'18px 0',padding:'12px 0',borderTop:`1px solid ${border}`}}><summary>{section.heading}</summary><Blocks blocks={section.blocks.filter(block=>!footer.includes(block))}/></details><Blocks blocks={footer}/></React.Fragment>;
  }
  const metadata=section.level===1?section.blocks.filter(block=>block.kind==='paragraph'&&/^(分析运行：|内容 SHA-256：)/.test(block.text)):[];
  const body=metadata.length?section.blocks.filter(block=>!metadata.includes(block)):section.blocks;
  return <section key={index}>{section.heading&&React.createElement(section.level===1?'h2':'h3',{style:{margin:section.level===1?'0 0 12px':'24px 0 12px',fontSize:section.level===1?22:16,fontWeight:650,lineHeight:1.4,overflowWrap:'anywhere'}},section.heading)}<Blocks blocks={body}/>{metadata.length>0&&<details style={{margin:'12px 0',color:secondary,fontSize:12}}><summary>查看报告运行信息</summary><Blocks blocks={metadata}/></details>}</section>;
 })}</article>;
}
