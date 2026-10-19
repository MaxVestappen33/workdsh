import React,{createContext,useContext} from 'react';
import {NativeWorkbenchSessionBridge} from './native-session-bridge.js';
import type {NativeWorkbenchConversationContext,NativeWorkbenchConversationDraft,NativeWorkbenchToolSettled} from './native-conversation-owner.js';

export interface NativeWorkbenchConversationSeat{readonly signal:AbortSignal;readonly active?:boolean;readonly setShown?:(shown:boolean)=>void;readonly setClose?:(close:(()=>void)|undefined)=>void;readonly openSession:(sessionId:string)=>void}
const Seat=createContext<NativeWorkbenchConversationSeat|undefined>(undefined);
export function NativeWorkbenchConversationSeatProvider({seat,children}:{seat:NativeWorkbenchConversationSeat;children:React.ReactNode}){
 return <Seat.Provider value={seat}>{children}</Seat.Provider>;
}
export interface NativeWorkbenchConversationProps{
 readonly sessionId?:string;readonly identityScopeKey:string;readonly native:NativeWorkbenchConversationContext;
 readonly draftRequest?:NativeWorkbenchConversationDraft;
 readonly onDraftReady?:(requestId:string)=>void;readonly onDraftError?:(requestId:string,error:unknown)=>void;
 readonly onSessionChange?:(sessionId:string|undefined)=>void;readonly onToolSettled?:(event:NativeWorkbenchToolSettled)=>void;
 readonly onError?:(error:unknown)=>void;readonly className?:string;readonly active?:boolean;readonly onClose?:()=>void;
}
/** Nonvisual bridge controlling only the owned outer layout. */
export function NativeWorkbenchConversation(props:NativeWorkbenchConversationProps){
 const seat=useContext(Seat);
 if(!seat)throw Error('workbench/native-conversation-outside-managed-page');
 const currentSession=React.useRef(props.sessionId);
 const open=()=>{const id=currentSession.current;if(id&&seat.active!==false){seat.openSession(id);seat.setShown?.(true);}};
 React.useEffect(()=>{if(seat.active===false)return;seat.setClose?.(props.onClose);return()=>seat.setClose?.(undefined);},[seat,props.onClose]);
 React.useEffect(()=>{if(seat.active===false)return;seat.setShown?.(props.active!==false&&!!props.sessionId);return()=>{seat.setShown?.(false);};},[seat,props.active,props.sessionId]);
 return <NativeWorkbenchSessionBridge {...props} signal={seat.signal}
  onSessionChange={id=>{currentSession.current=id;props.onSessionChange?.(id);if(id&&!props.draftRequest&&props.active!==false)open();}}
  onDraftReady={id=>{props.onDraftReady?.(id);open();}}
  onDraftError={(id,error)=>{props.onDraftError?.(id,error);open();}}/>;
}
export type{NativeWorkbenchConversationDraft,NativeWorkbenchToolSettled}from'./native-conversation-owner.js';
