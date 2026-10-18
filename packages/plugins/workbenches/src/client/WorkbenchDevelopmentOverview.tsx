import React, {useState} from 'react';
import {workbenchDeliveryState} from './delivery-state.js';
import type {WorkbenchCatalogEntry} from './catalog-client.js';
import type {WorkbenchDevelopmentIndexEntry} from 'workdsh-contracts';
import type {CreationView} from './creation-client.js';
const labels:Record<string,string>={requirements:'需求待完善',ready:'准备制作',developing:'制作中',built:'可检查新版本','pending-install':'待安装','pending-restart':'待重启',trial:'待试用','changes-requested':'待修改',accepted:'本轮已完成',interrupted:'已中断',failed:'需要处理'};
export function WorkbenchDevelopmentOverview(props:{developments:readonly WorkbenchDevelopmentIndexEntry[];catalog?:readonly WorkbenchCatalogEntry[];canOpen?:(id:string)=>boolean;creations:readonly CreationView[];error?:string;onContinue:(id:string)=>void;onDiscuss:(id:string)=>void;onAll?:()=>void;heading?:string;limit?:number;compact?:boolean}){
 const [page,setPage]=useState(0);
 const rows=[...props.creations.map(row=>({id:row.id,title:row.idea,status:'需求讨论',updatedAt:row.createdAt,discuss:true})),...props.developments.map(row=>({id:row.development.id,title:row.title,status:props.catalog?.some(app=>app.packageName===row.development.packageName)?workbenchDeliveryState(props.catalog.find(app=>app.packageName===row.development.packageName),!!props.canOpen?.(row.development.workbenchId),0,false).title:labels[row.development.state]??'制作记录',updatedAt:row.development.updatedAt,discuss:false}))].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const size=props.limit??6,pageCount=Math.max(1,Math.ceil(rows.length/size)),currentPage=Math.min(page,pageCount-1);
 return <section className={`wd-making-overview${props.compact?' wd-making-overview-compact':''}`} aria-label="正在制作的应用"><header><div>{!props.compact&&<h2>{props.heading??'正在制作'}</h2>}<p>{props.compact?'继续最近的制作或修改。':'想法、开发进度和后续修改，都从这里继续。'}</p></div>{props.onAll&&<button onClick={props.onAll}>{props.compact?'管理开发记录':'全部制作记录'}{!props.compact&&rows.length?` · ${rows.length}`:''}</button>}</header>
 {props.error&&<p role="alert">{props.error}</p>}
 {rows.length?<div className="wd-making-list">{rows.slice(currentPage*size,(currentPage+1)*size).map(row=><article key={`${row.discuss?'idea':'app'}:${row.id}`}><span className="wd-making-mark" aria-hidden="true">↗</span><div className="wd-making-name"><h3>{row.title}</h3><p>{row.status}<span> · {new Date(row.updatedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></p></div><button data-variant={props.compact?undefined:'primary'} onClick={()=>row.discuss?props.onDiscuss(row.id):props.onContinue(row.id)}>{row.discuss?'继续讨论':'查看进度'}</button></article>)}</div>:!props.error&&<p>还没有制作记录。点击“用 AI 创建”，描述你想完成的工作。</p>}
 {props.compact&&<nav className="wd-catalog-pagination" aria-label="制作记录分页"><span role="status">共 {rows.length} 个 · 第 {currentPage+1} / {pageCount} 页</span><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button><button disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}
 </section>;
}
