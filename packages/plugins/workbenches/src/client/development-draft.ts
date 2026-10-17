/** Native UI adapter supplies these ports. Draft handoff does not send a message,
 * create a second Agent, or infer that development/installation has completed. */
export interface WorkbenchDevelopmentDraftPorts {
  openSession(sessionId: string): Promise<void>;
  readDraft(sessionId: string): { readonly text: string; readonly revision: string };
  writeDraft(sessionId: string, text: string, expectedRevision: string): void;
}
export async function handoffWorkbenchDevelopmentDraft(ports: WorkbenchDevelopmentDraftPorts,
  sessionId: string, instruction: string, signal?: AbortSignal) {
  if (!sessionId.trim() || !instruction.trim()) throw new Error('workbench/invalid-development-draft');
  signal?.throwIfAborted();
  const current = ports.readDraft(sessionId);
  signal?.throwIfAborted();
  // Repeated navigation after a lost UI receipt must not overwrite user's edits.
  if (current.text !== instruction) {
    if (current.text.trim()) throw new Error('workbench/development-draft-not-empty');
    ports.writeDraft(sessionId, instruction, current.revision);
  }
  // Navigation may unmount and cancel the initiating editor. The retained
  // Session already owns the draft, so that cancellation is not a failed handoff.
  await ports.openSession(sessionId);
}
