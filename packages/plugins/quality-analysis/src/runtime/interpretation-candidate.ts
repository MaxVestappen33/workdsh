import {createHash} from 'node:crypto';
export interface QualityInterpretationSource {readonly recordId:string;readonly runId:string;readonly contentHash:string;readonly sessionId:string;}
export interface QualityInterpretationCandidate extends QualityInterpretationSource {readonly eventSeq:number;readonly turn:number;readonly text:string;readonly candidateHash:string;}
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
/** Decode only a settled native assistant message. Streams, reasoning and tool
 * payloads are never presented as a completed interpretation. No statistics mutate.
 * The caller must verify the fixed run and native Session ownership first. */
export function readQualityInterpretationCandidate(source:QualityInterpretationSource,events:readonly unknown[]):QualityInterpretationCandidate|undefined{
 if(!source.recordId.trim()||!source.runId.trim()||!source.sessionId.trim()||!/^[a-f0-9]{64}$/.test(source.contentHash))throw Error('quality/interpretation/invalid-source');
 if(events.length>4096)throw Error('quality/interpretation/history-budget');
 let turn:number|undefined,completed=false,message:{eventSeq:number;data:Record<string,unknown>}|undefined;
 let previousSeq=-1;
 for(const raw of events){const event=object(raw),data=object(event?.data);
  if(!event||!data||!Number.isSafeInteger(event.seq)||(event.seq as number)<=previousSeq)throw Error('quality/interpretation/invalid-history');
  previousSeq=event.seq as number;
  if(event.type==='turn/start'){if(!Number.isSafeInteger(data.turn))throw Error('quality/interpretation/invalid-history');turn=data.turn as number;completed=false;message=undefined;}
  if(event.type==='assistant/message'&&data.turn===turn){message={eventSeq:previousSeq,data};completed=false;}
  if(event.type==='turn/end'&&data.turn===turn)completed=object(data.reason)?.kind==='completed';
 }
 // A newer active, interrupted or failed turn must not masquerade as its prior result.
 if(!completed||!message||turn===undefined||message.data.interrupted===true)return;
 const content=object(message.data.message)?.content;
 if(!Array.isArray(content))throw Error('quality/interpretation/invalid-message');
 const parts:string[]=[];let byteLength=0;
 for(const raw of content){const block=object(raw);if(block?.type==='tool-call')return;if(block?.type!=='text')continue;
  if(typeof block.text!=='string')throw Error('quality/interpretation/invalid-message');
  byteLength+=new TextEncoder().encode(block.text).byteLength;if(byteLength>64*1024)throw Error('quality/interpretation/text-budget');parts.push(block.text);
 }
 const text=parts.join('\n\n').trim();if(!text)return;
 const value={recordId:source.recordId,runId:source.runId,contentHash:source.contentHash,sessionId:source.sessionId,eventSeq:message.eventSeq,turn,text};
 return Object.freeze({...value,candidateHash:createHash('sha256').update(JSON.stringify(value)).digest('hex')});
}
