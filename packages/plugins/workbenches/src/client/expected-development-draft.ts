import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client';

/** Native skill chips retain the same clipboard-text projection as the prompt.
 * Allow only the named skills already present in its leading skill line. */
export function isExpectedDevelopmentDraft(state: Pick<InputState, 'draft' | 'attachmentIds' | 'occurrences'>, instruction: string) {
  if (state.draft !== instruction || state.attachmentIds.length) return false;
  const leading = /^(?:\/(?:cordis-plugin-development|workdsh-workbench-dev))(?:[ \t]+\/(?:cordis-plugin-development|workdsh-workbench-dev))*(?=\n|$)/.exec(instruction)?.[0];
  let end = 0;
  for (const occurrence of state.occurrences) {
    if (!leading || occurrence.source !== 'skill' || occurrence.invalid ||
        !['/cordis-plugin-development', '/workdsh-workbench-dev'].includes(occurrence.ref) ||
        occurrence.clipboardText !== occurrence.ref || !Number.isInteger(occurrence.offset) ||
        occurrence.offset < end || occurrence.length !== occurrence.ref.length ||
        occurrence.offset + occurrence.length > leading.length ||
        instruction.slice(occurrence.offset, occurrence.offset + occurrence.length) !== occurrence.ref ||
        (occurrence.offset > 0 && !/[ \t]/.test(instruction[occurrence.offset - 1]))) return false;
    end = occurrence.offset + occurrence.length;
  }
  return true;
}
