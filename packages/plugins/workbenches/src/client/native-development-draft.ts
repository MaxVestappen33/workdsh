import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import { handoffWorkbenchDevelopmentDraft } from './development-draft.js';

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { workdshWorkbenchDraft: unknown }
}
/** Hold the official Session generation while handing the prompt to its native
 * input. The user sends it using the existing model/permission controls. */
export async function handoffNativeWorkbenchDraft(ctx: Pick<Context, 'sessions' | 'conversation' | 'uiWorkspace' | 'layout'>,
  sessionId: Parameters<ISessions['retain']>[0], instruction: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const reference = ctx.sessions.retain(sessionId, { source: 'workdshWorkbenchDraft', signal });
  try {
    await reference.ready;
    signal?.throwIfAborted();
    // Read the official projection after resume, not a requested creation value.
    // Existing conversations keep their preset, model, permissions and history.
    const preset = reference.binding.session.projections.faceOf('agentPreset').getSnapshot();
    if (preset !== 'cordis') throw new Error('workbench/development-creator-required');
    const input = ctx.conversation.input.for(reference.binding.ctx);
    await handoffWorkbenchDevelopmentDraft({
      async openSession() { ctx.uiWorkspace.openSession(sessionId); ctx.layout.selectPanel(null); },
      readDraft() { const state = input.state.getSnapshot(); return { text: state.draft, revision: String(state.draftRev) }; },
      writeDraft(_id, text, revision) {
        const state = input.state.getSnapshot();
        if (String(state.draftRev) !== revision || state.draft.trim()) throw new Error('workbench/development-draft-conflict');
        input.setDraft(text);
      },
    }, String(sessionId), instruction, signal);
  } finally { reference.release(); }
}
