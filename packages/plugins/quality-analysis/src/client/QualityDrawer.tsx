import React,{useEffect,useRef} from 'react';

// Native dialogs enter the top layer, outside container-query/fixed ancestors.
// Keep the existing overlay/panel classes so individual drawers retain their layout.
const dialogCss=`.wd-quality-overlay.wd-quality-modal{margin:0;border:0;padding:0;width:100dvw;max-width:100dvw;height:100dvh;max-height:100dvh;box-sizing:border-box;color:inherit}.wd-quality-modal::backdrop{background:transparent}`;

/** Keep children mounted for background loading; focus enters only on open. */
export function QualityDrawer({open,title,onClose,children,inline=false,placement='right',subtitle,footer,className='',closeLabel='关闭',closeDisabled=false}:{
 open:boolean;title:string;onClose:()=>void;children:React.ReactNode;inline?:boolean;placement?:'right'|'center';
 subtitle?:React.ReactNode;footer?:React.ReactNode;className?:string;closeLabel?:string;closeDisabled?:boolean;
}){
 const panel=useRef<HTMLElement>(null),dialog=useRef<HTMLDialogElement>(null),close=useRef(onClose),blocked=useRef(closeDisabled);close.current=onClose;blocked.current=closeDisabled;
 const requestClose=()=>{if(!blocked.current)close.current();};
 useEffect(()=>{
  if(!open||inline||!panel.current||!dialog.current)return;
  const host=panel.current,modal=dialog.current,previous=document.activeElement;
  // Older embedded clients may not provide showModal. They retain the prior
  // overlay/focus behavior; never mark an ordinary open dialog as top-layer.
  if(typeof modal.showModal==='function'){
   try{modal.showModal();}catch{modal.setAttribute('open','');}
  }else modal.setAttribute('open','');
  const focusable=()=>Array.from(host.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex="0"]')).filter(node=>!node.closest('[hidden]')&&node.getClientRects().length>0);
  (focusable()[0]??host).focus();
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();requestClose();}
   if(event.key==='Tab'){
    const items=focusable(),first=items[0],last=items.at(-1);
    if(!first){event.preventDefault();host.focus();}
    else if(event.shiftKey&&(document.activeElement===first||document.activeElement===host)){event.preventDefault();last!.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!host.contains(document.activeElement))){event.preventDefault();first.focus();}
   }
  };
  host.addEventListener('keydown',keydown);
  return()=>{
   host.removeEventListener('keydown',keydown);
   if(modal.open){if(typeof modal.close==='function')modal.close();else modal.removeAttribute('open');}
   if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();
  };
 },[open,inline]);
 const content=<section ref={panel} tabIndex={-1} className={`${inline?'wd-quality-start':'wd-quality-history-drawer'}${className?' '+className:''}`} aria-label={title}>
   {!inline&&<header><div><h2>{title}</h2>{subtitle&&<p className="wd-quality-modal-subtitle">{subtitle}</p>}</div><button type="button" disabled={closeDisabled} aria-label={`关闭${title}`} onClick={requestClose}>{closeLabel}</button></header>}
   {placement==='center'&&!inline?<div className="wd-quality-modal-body">{children}</div>:children}
   {footer&&<footer className="wd-quality-modal-footer">{footer}</footer>}
  </section>;
 if(inline)return <div className="wd-quality-inline-panel" hidden={!open}>{content}</div>;
 return <><style>{dialogCss}</style><dialog ref={dialog} className={`wd-quality-overlay wd-quality-modal${placement==='center'?' wd-quality-centered':''}`} hidden={!open} aria-label={title} aria-modal={open?true:undefined}
  onCancel={event=>{event.preventDefault();event.stopPropagation();requestClose();}}
  onClick={event=>{if(event.target===event.currentTarget)requestClose();}}>
  {content}
 </dialog></>;
}
