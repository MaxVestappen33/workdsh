import type { Context } from '@deepseek-ai/cordis';
import { isExpectedDevelopmentDraft } from './expected-development-draft.js';
import type { SessionReference, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { workdshWorkbenchConversation: unknown }
}

export interface NativeWorkbenchToolSettled {
  readonly sessionId: string;
  readonly sequence: number;
  readonly callId: string;
  /** Aborted when the record, identity, page or mounted Session changes. */
  readonly signal: AbortSignal;
}
export interface NativeWorkbenchConversationDraft {
  readonly id: string;
  readonly instruction: string;
  /** Only set by an explicit user action that starts this discussion. */
  readonly submit?: boolean;
}
export type NativeWorkbenchConversationContext = Pick<Context, 'sessions' | 'conversation'>;
const seats = new WeakMap<object, Map<string, object>>();
const submitted = new WeakMap<object, Map<string, string>>();

/** Own one mounted native composer and its exact Controller generation. No
 * navigation, model override or Agent is created. Submission is opt-in for an
 * explicit start action; merely mounting a conversation still never sends. */
export class NativeWorkbenchConversationOwner {
  readonly reference: SessionReference;
  readonly signal: AbortSignal;
  readonly ready: Promise<SessionBinding>;
  private readonly controller = new AbortController();
  private readonly requests = new Map<string, { instruction: string; submit: boolean; result: Promise<void> }>();
  private unsubscribe?: () => void;
  private disposed = false;
  private readonly roster: Map<string, object>;

  constructor(private readonly native: NativeWorkbenchConversationContext,
    readonly sessionId: string, readonly identityScopeKey: string,
    options: { readonly signal?: AbortSignal; readonly onToolSettled?: (event: NativeWorkbenchToolSettled) => void } = {}) {
    if (!sessionId.trim() || sessionId.length > 256 || !identityScopeKey.trim()) throw new Error('workbench/invalid-conversation-context');
    this.signal = options.signal ? AbortSignal.any([this.controller.signal, options.signal]) : this.controller.signal;
    this.signal.throwIfAborted();
    this.roster = seats.get(native.sessions) ?? new Map();
    seats.set(native.sessions, this.roster);
    if (this.roster.has(sessionId)) throw new Error('workbench/conversation-already-mounted');
    this.roster.set(sessionId, this);
    try {
      this.reference = native.sessions.retain(sessionId as SessionReference['sessionId'], { source: 'workdshWorkbenchConversation', signal: this.signal });
    } catch (error) { this.roster.delete(sessionId); throw error; }
    this.ready = this.reference.ready.then(binding => {
      this.assertCurrent();
      if (String(binding.sessionId) !== sessionId) throw new Error('workbench/conversation-session-mismatch');
      if (options.onToolSettled) this.watchTools(binding, options.onToolSettled);
      return binding;
    }).catch(error => { this.dispose(); throw error; });
    this.signal.addEventListener('abort', () => this.dispose(), { once: true });
  }

  private assertCurrent() {
    this.signal.throwIfAborted();
    if (this.disposed || this.roster.get(this.sessionId) !== this) throw new Error('workbench/conversation-disposed');
  }

  /** Request identities deduplicate React re-renders. The official initialization
   * API keeps persisted drafts, references and pending submission ownership. */
  prepareDraft(request: NativeWorkbenchConversationDraft): Promise<void> {
    this.assertCurrent();
    if (!request.id.trim() || request.id.length > 256 || !request.instruction.trim() || new TextEncoder().encode(request.instruction).byteLength > 64 * 1024) {
      return Promise.reject(new Error('workbench/invalid-conversation-draft'));
    }
    const prior = this.requests.get(request.id);
    if (prior) return prior.instruction === request.instruction && prior.submit === !!request.submit ? prior.result : Promise.reject(new Error('workbench/conversation-draft-request-mismatch'));
    let attempted = false;
    const result = this.ready.then(binding => {
      this.assertCurrent();
      const key = JSON.stringify([this.identityScopeKey, request.id]);
      const issued = submitted.get(binding.ctx);
      if (request.submit && issued?.has(key)) {
        if (issued.get(key) !== request.instruction) throw new Error('workbench/conversation-draft-request-mismatch');
        return;
      }
      const input = this.native.conversation.input.for(binding.ctx);
      const current = input.state.getSnapshot();
      if (current.phase !== 'plain') throw new Error('workbench/conversation-input-busy');
      const matches = isExpectedDevelopmentDraft(current, request.instruction);
      if (!matches) {
        if (current.draft.trim() || current.attachmentIds.length || current.occurrences.length) throw new Error('workbench/development-draft-not-empty');
        const outcome = this.native.conversation.input.requestDraftInitialization(binding, { prompt: request.instruction, clearPreviousDraft: false });
        if (outcome !== 'applied' || !isExpectedDevelopmentDraft(input.state.getSnapshot(), request.instruction)) throw new Error('workbench/conversation-draft-preserved');
      }
      this.assertCurrent();
      if (request.submit) {
        const now = input.state.getSnapshot();
        if (now.phase !== 'plain' || !isExpectedDevelopmentDraft(now, request.instruction)) throw new Error('workbench/development-draft-not-empty');
        const ledger = submitted.get(binding.ctx) ?? new Map<string, string>();
        submitted.set(binding.ctx, ledger);
        // Claim before invoking the native transaction. An uncertain send must
        // not be replayed by re-renders or a bridge remount in this Session.
        ledger.set(key, request.instruction);
        attempted = true;
        try { input.submit(undefined, 'click'); }
        catch (cause) { throw new Error('workbench/conversation-submit-unconfirmed', { cause }); }
      }
    }).catch(error => { if (!attempted) this.requests.delete(request.id); throw error; });
    this.requests.set(request.id, { instruction: request.instruction, submit: !!request.submit, result });
    return result;
  }

  private watchTools(binding: SessionBinding, onToolSettled: (event: NativeWorkbenchToolSettled) => void) {
    // Initial history is a baseline; history pagination never repeats live
    // business refreshes. The official feed remains entirely read-only here.
    const source = binding.eventSource;
    let sequence = source.getSnapshot().entries.reduce((max, entry) => entry.type === 'event' ? Math.max(max, entry.event.seq) : max, -1);
    const sync = () => {
      if (this.signal.aborted || this.disposed) return;
      const window = source.getSnapshot();
      if (window.change.kind === 'prepend') return;
      const entries = window.change.kind === 'append' ? window.change.entries : window.entries;
      for (const entry of entries) {
        const event = entry.event;
        if (entry.type !== 'event' || event.seq <= sequence) continue;
        sequence = event.seq;
        if (event.type !== 'tool/result') continue;
        const callId = event.data.message.toolCallId;
        // Consumer failure must never break the native event publisher.
        try { onToolSettled({ sessionId: this.sessionId, sequence, callId, signal: this.signal }); } catch { /* caller owns feedback */ }
      }
    };
    this.unsubscribe = source.subscribe(sync);
    this.signal.addEventListener('abort', () => { this.unsubscribe?.(); this.unsubscribe = undefined; }, { once: true });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    this.unsubscribe?.(); this.unsubscribe = undefined;
    try { this.reference.release(); }
    finally { if (this.roster.get(this.sessionId) === this) this.roster.delete(this.sessionId); }
  }
}
