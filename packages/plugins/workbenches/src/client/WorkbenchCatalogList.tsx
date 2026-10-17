import {WorkbenchMenu} from './WorkbenchMenu.js';
import React from 'react';
import type {WorkbenchDevelopmentIndexEntry} from 'workdsh-contracts';
import type {WorkbenchCatalogEntry} from './catalog-client.js';
import {catalogStatus} from './catalog-status.js';

export function WorkbenchCatalogList(props:{
  entries:readonly WorkbenchCatalogEntry[]; developments:readonly WorkbenchDevelopmentIndexEntry[]; busy:boolean;
  canOpen:(id:string)=>boolean; onOpen:(id:string)=>void; onContinue:(id:string)=>void;
  onSetEnabled:(entry:WorkbenchCatalogEntry,enabled:boolean)=>void;
  pinnedIds?:readonly string[];pinReady?:boolean;onPin?:(id:string,pinned:boolean)=>void;
}){
  return <div className="wd-catalog-list">{props.entries.map(entry=>{
    const status=catalogStatus(entry),title=entry.descriptor?.title??entry.packageName;
    const source=props.developments.find(row=>row.development.packageName===entry.packageName);
    const ready=!props.busy&&status.label==='已启用'&&!!entry.descriptor&&props.canOpen(entry.descriptor.id);
    return <article key={entry.packageName} className="wd-catalog-row" aria-label={title}>
      <span className="wd-catalog-row-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
      <div className="wd-catalog-row-content"><h2>{title}</h2><p className="wd-catalog-row-description">{entry.descriptor?.description??'此插件暂未提供工作台说明。'}</p>
        {status.detail&&<p className="wd-catalog-row-notice" role="status">{status.detail}</p>}
        {!!entry.missingResourceCatalogs?.length&&<p className="wd-catalog-row-notice" role="status">资源服务尚未就绪：{entry.missingResourceCatalogs.map(item=>({'skill.select':'技能','expert.select':'专家','connector.invoke':'连接器'}[item])).join('、')}。安装相应资源插件后刷新。</p>}
      </div>
      <span className="wd-catalog-row-state" data-warning={entry.selected&&status.label!=='已启用'}>{status.label==='已启用'?'可用':status.label}</span>
      <div className="wd-catalog-row-actions">
        {entry.installed&&entry.descriptor&&!entry.selected?<button disabled={props.busy||!entry.compatible} aria-label={`启用${title}`} onClick={()=>props.onSetEnabled(entry,true)}>启用</button>:source&&entry.selected&&status.label!=='已启用'?<button disabled={props.busy} onClick={()=>props.onContinue(source.development.id)}>查看进度</button>:<button disabled={!ready} aria-label={`打开${title}`} onClick={()=>entry.descriptor&&props.onOpen(entry.descriptor.id)}>打开 <span aria-hidden="true">↗</span></button>}
        <WorkbenchMenu label={`${title}的管理操作`} items={[
          {type:'label',id:'version',text:`版本 ${entry.version??'未确认'}`},
          ...(entry.descriptor&&props.onPin?[{id:'pin',label:props.pinnedIds?.includes(entry.descriptor.id)?'取消常用':'设为常用',disabled:!props.pinReady||props.busy||(!props.pinnedIds?.includes(entry.descriptor.id)&&!ready)}]:[]),
          ...(source?[{id:'continue',label:'查看制作进度',disabled:props.busy}]:[]),
          ...(entry.installed&&entry.descriptor&&entry.selected?[{type:'separator' as const,id:'separator'},{id:'disable',label:'停用工作台',disabled:props.busy}]:[])
        ]} onSelect={id=>{if(id==='pin'&&entry.descriptor)props.onPin?.(entry.descriptor.id,!props.pinnedIds?.includes(entry.descriptor.id));if(id==='continue'&&source)props.onContinue(source.development.id);if(id==='disable')props.onSetEnabled(entry,false);}}>···</WorkbenchMenu>
      </div>
    </article>;
  })}</div>;
}
