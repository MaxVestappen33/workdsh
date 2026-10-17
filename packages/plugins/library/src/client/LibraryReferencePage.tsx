import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { LibraryOriginalPreviewInput, LibraryOriginalPreviewRegistry } from 'workdsh-contracts/library';
import type { LibraryClient } from './management.js';
import {createLibraryOriginalRevisionSave} from './original-revision-save.js';

type Params = { assetId?: string; revisionId?: string; name?: string; kind?: string;returnPanelId?:string;returnLabel?:string;saveOriginal?:boolean };
type Props = PropsRuntime<'sidebar.right.pane.tab'> & { management: LibraryClient; previewRegistry: LibraryOriginalPreviewRegistry;registerCloseGuard:(tabId:string,guard:()=>void)=>()=>void;returnToPanel:(id:string)=>void };

export function LibraryReferencePage({ management, previewRegistry, useTabInfo,registerCloseGuard,returnToPanel }: Props) {
  const info = useTabInfo();
  const params = info.tab.navigation.params as Params | undefined;
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [office, setOffice] = useState<LibraryOriginalPreviewInput>();
  const [error, setError] = useState('');
  const [notice,setNotice]=useState('');
  const [saving,setSaving]=useState(false);
  const saveBusy=useRef(false);
  const officeHost = useRef<HTMLDivElement>(null);
  useEffect(()=>registerCloseGuard(String(info.tab.id),()=>{if(saveBusy.current)throw new Error('源文件正在保存，请等待结果后关闭。');}),[info.tab.id,registerCloseGuard]);
  useEffect(()=>{
    const leave=(event:BeforeUnloadEvent)=>{if(saveBusy.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);
  },[]);
  useEffect(() => {
    setHtml(''); setText(''); setOffice(undefined); setError('');setNotice('');
    setUrl(old => { if (old) URL.revokeObjectURL(old); return ''; });
    if (!params?.assetId || !params.revisionId) { setError('资料引用不完整。'); return; }
    let active = true;
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,info.tab.signal]);
    const run = async () => {
      try {
        if (params.kind === 'html' || params.kind === 'pdf' || params.kind === 'docx' || params.kind === 'pptx' || params.kind === 'csv' || params.kind === 'xlsx') {
          const bytes = await management.readOriginal(params.assetId!, params.revisionId,signal);
          if (!active) return;
          if (params.kind === 'html') setHtml(new TextDecoder().decode(bytes));
          else if (params.kind === 'pdf') setUrl(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })));
          else if (previewRegistry.canOpen(params.kind)) {
            const save=params.kind==='xlsx'&&params.saveOriginal===true?createLibraryOriginalRevisionSave({assetId:params.assetId!,revisionId:params.revisionId!,kind:params.kind},(input,saveSignal)=>management.saveOriginalRevision(input,saveSignal),()=>{if(active)setNotice('新版本已保存。返回工作台后可采用新版本继续分析。');}):undefined;
            setOffice({ name: params.name ?? '资料', kind: params.kind, bytes,...(save?{onSaveOriginal:async(nextBytes:Uint8Array,officeSignal:AbortSignal)=>{
              if(saveBusy.current)throw new Error('源文件正在保存，请等待结果。');
              saveBusy.current=true;if(active){setSaving(true);setNotice('正在保存源文件…');}
              try{await save(nextBytes,AbortSignal.any([officeSignal,signal]));}
              catch(cause){if(active)setNotice('保存结果未确认，请在资料库核对新版本后继续。');throw cause;}
              finally{saveBusy.current=false;if(active)setSaving(false);}
            }}:{}) } as LibraryOriginalPreviewInput);
          }
          else {const next=await management.readText(params.assetId!, params.revisionId,signal);if(active)setText(next);}
        } else {const next=await management.readText(params.assetId!, params.revisionId,signal);if(active)setText(next);}
      } catch { if (active&&!signal.aborted) setError('源文件无法打开，请核对资料访问权限后重试。'); }
    };
    void run();
    return () => { active = false;controller.abort(); };
  }, [management, params?.assetId, params?.revisionId, params?.kind, params?.name,params?.saveOriginal,info.tab.navigation.revision,info.tab.signal]);
  useEffect(() => {
    if (!office || !officeHost.current) return;
    let dispose = () => {};
    let active = true;
    void previewRegistry.mount(officeHost.current, office).then(next => { if (active) dispose = next; else next(); }).catch(()=>{if(active)setError('系统文件预览暂时不可用，请重新打开。');});
    return () => { active = false; dispose(); };
  }, [office, previewRegistry]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return <section aria-label="资料引用预览" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' }}>
    <header style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--dsw-alias-border-l2)',fontSize:13,display:'flex',alignItems:'center',gap:12 }}><strong style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{params?.name ?? '资料预览'}</strong>{params?.returnPanelId&&<button type="button" disabled={saving} onClick={()=>{if(saveBusy.current)return;try{returnToPanel(params.returnPanelId!);}catch{setNotice('原工作台暂时不可用，可从左侧工作台列表重新打开。');}}}>{params.returnLabel??'返回工作台'}</button>}</header>
    {notice&&<p role="status" style={{margin:0,padding:'10px 16px',fontSize:13,color:'var(--dsw-alias-label-secondary)'}}>{notice}</p>}
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{error ? <div style={{ padding: 24, color: 'var(--dsw-alias-state-error-primary)' }}>{error}</div> : html ? <iframe title={params?.name} sandbox="allow-scripts" srcDoc={isolateHtml(html)} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} /> : url ? <iframe title={params?.name} src={url} style={{ width: '100%', height: '100%', border: 0 }} /> : office ? <div ref={officeHost} style={{ height: '100%' }} /> : text ? <pre style={{ margin: 0, padding: 24, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', lineHeight: 1.7 }}>{text}</pre> : <div style={{ padding: 24, color: 'var(--dsw-alias-label-tertiary)' }}>正在读取资料…</div>}</div>
  </section>;
}

function isolateHtml(source: string) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none';">`;
  return /<head(?:\s[^>]*)?>/i.test(source) ? source.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${policy}`) : `${policy}${source}`;
}
