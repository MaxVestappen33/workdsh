import { useEffect, useRef, useState } from 'react';
import { NativeWorkbenchConversationOwner, type NativeWorkbenchConversationContext, type NativeWorkbenchConversationDraft, type NativeWorkbenchToolSettled } from './native-conversation-owner.js';

export interface NativeWorkbenchSessionBridgeProps {
  /** Only a Session id returned by the caller's authorized Host operation. */
  readonly sessionId?: string;
  readonly identityScopeKey: string;
  readonly native: NativeWorkbenchConversationContext;
  /** Optional lifetime of the business surface that owns this association. */
  readonly signal?: AbortSignal;
  readonly draftRequest?: NativeWorkbenchConversationDraft;
  readonly onDraftReady?: (requestId: string) => void;
  readonly onDraftError?: (requestId: string, error: unknown) => void;
  readonly onSessionChange?: (sessionId: string | undefined) => void;
  readonly onToolSettled?: (event: NativeWorkbenchToolSettled) => void;
  readonly onError?: (error: unknown) => void;
}

/** Retain the authorized Session, prepare its native draft and observe real
 * tool receipts while the SDK owns the complete Conversation presentation.
 * It renders no alternate Conversation. Only explicit submit draft requests
 * invoke the native input's existing submission transaction. */
export function NativeWorkbenchSessionBridge(props: NativeWorkbenchSessionBridgeProps) {
  const callbacks = useRef(props); callbacks.current = props;
  const [mounted, setMounted] = useState<{ key: string; native: NativeWorkbenchConversationContext; owner: NativeWorkbenchConversationOwner }>();
  const key = JSON.stringify([props.identityScopeKey, props.sessionId]);
  useEffect(() => {
    if (!props.sessionId) return;
    let owner: NativeWorkbenchConversationOwner;
    let active = true;
    try {
      owner = new NativeWorkbenchConversationOwner(props.native, props.sessionId, props.identityScopeKey, {
        signal: props.signal,
        onToolSettled: event => callbacks.current.onToolSettled?.(event),
      });
    } catch (error) {
      callbacks.current.onError?.(error);
      if (callbacks.current.draftRequest) callbacks.current.onDraftError?.(callbacks.current.draftRequest.id, error);
      return;
    }
    void owner.ready.then(() => {
      if (!active || owner.signal.aborted) return;
      setMounted({ key, native: props.native, owner });
      callbacks.current.onSessionChange?.(owner.sessionId);
    }, error => {
      if (!active || props.signal?.aborted) return;
      callbacks.current.onError?.(error);
      if (callbacks.current.draftRequest) callbacks.current.onDraftError?.(callbacks.current.draftRequest.id, error);
      owner.dispose();
    });
    return () => { active = false; owner.dispose(); };
  }, [props.native, key, props.signal]);
  const request = props.draftRequest;
  useEffect(() => {
    if (!request || !mounted || mounted.key !== key || mounted.native !== props.native || mounted.owner.signal.aborted) return;
    let active = true;
    void Promise.resolve().then(() => mounted.owner.prepareDraft(request)).then(() => {
      if (active && !mounted.owner.signal.aborted) callbacks.current.onDraftReady?.(request.id);
    }, error => {
      if (active && !mounted.owner.signal.aborted) callbacks.current.onDraftError?.(request.id, error);
    });
    return () => { active = false; };
  }, [mounted, key, props.native, request?.id, request?.instruction, request?.submit]);
  return null;
}
