import JSZip from 'jszip';
import {SaxesParser} from 'saxes';
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\r/g,'&#13;').replace(/\n/g,'&#10;').replace(/\t/g,'&#9;');
// ExcelJS 4.4 matches SpreadsheetML element names without namespace prefixes.
// Normalize only that namespace through XML events; preserve the original bytes.
function normalize(xml){
 let output='',spreadsheet=false,rootSeen=false;const p=new SaxesParser({xmlns:true});
 p.on('doctype',()=>{throw Error('WORKSHEET_XML_DOCTYPE_UNSUPPORTED');});
 p.on('opentag',tag=>{
  if(!rootSeen){spreadsheet=tag.uri===MAIN;rootSeen=true;}
  if(!spreadsheet)return;
  const main=tag.uri===MAIN,name=main?tag.local:tag.name;
  const attrs=Object.values(tag.attributes).filter(a=>!(main&&a.name==='xmlns')).map(a=>` ${a.name}="${esc(a.value)}"`).join('');
  output+=`<${name}${main?` xmlns="${MAIN}"`:''}${attrs}>`;
 });
 p.on('closetag',tag=>{if(spreadsheet)output+=`</${tag.uri===MAIN?tag.local:tag.name}>`;});
 p.on('text',s=>{if(spreadsheet)output+=esc(s);});
 p.on('cdata',s=>{if(spreadsheet)output+=esc(s);});
 p.on('error',e=>{throw e;});p.write(xml).close();return spreadsheet?output:xml;
}
export async function compatibleXlsxBytes(bytes,signal){
 signal?.throwIfAborted();const zip=await JSZip.loadAsync(bytes);let changed=false,total=0;
 const entries=Object.values(zip.files).filter(e=>!e.dir&&/^xl\/.*\.xml$/.test(e.name));
 if(entries.length>1000)throw Error('WORKSHEET_XML_LIMIT');
 for(const entry of entries){
  signal?.throwIfAborted();const xml=await entry.async('string');total+=Buffer.byteLength(xml);
  if(total>64*1024*1024)throw Error('WORKSHEET_XML_LIMIT');
  if(!xml.includes(MAIN)||!/<[A-Za-z_][\w.-]*:/.test(xml))continue;
  const normalized=normalize(xml);if(normalized!==xml){zip.file(entry.name,normalized);changed=true;}
 }
 return changed?zip.generateAsync({type:'nodebuffer'}):bytes;
}
