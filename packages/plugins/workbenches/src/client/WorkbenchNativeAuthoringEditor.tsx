import React, { useMemo } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import { WorkbenchAuthoringEditor, type WorkbenchAuthoringEditorProps } from './WorkbenchAuthoringEditor.js';
import { handoffNativeWorkbenchDraft } from './native-development-draft.js';
import { createWorkbenchDevelopmentClient } from './development-client.js';
import { createWorkbenchDevelopmentInstruction } from './development-instruction.js';

export interface WorkbenchNativeAuthoringEditorProps extends Omit<WorkbenchAuthoringEditorProps, 'onAssociated'> {
  readonly native: Pick<Context, 'sessions' | 'conversation' | 'uiWorkspace' | 'layout'>;
  /** A persisted development and Session exist, independently of draft delivery. */
  readonly onDraftPrepared?: (entry: import('workdsh-contracts').WorkbenchDevelopmentIndexEntry, instruction:string)=>void;
  readonly onDevelopmentReady?: (developmentId: string) => void;
}
/** Joins the already-implemented save/association receipt to official input.
 * The Host prepares source and verifies the persistent Session association;
 * this component cannot claim a generated or installed plugin. */
export function WorkbenchNativeAuthoringEditor(props: WorkbenchNativeAuthoringEditorProps) {
  const client = useMemo(() => createWorkbenchDevelopmentClient(), []);
  return <WorkbenchAuthoringEditor key={JSON.stringify([props.identityScopeKey, props.developmentId])}
    developmentId={props.developmentId} identityScopeKey={props.identityScopeKey}
    workbenchId={props.workbenchId} packageName={props.packageName} onCancel={props.onCancel}
    onAssociated={async (entry, signal, _instruction, saved) => {
      if (!saved) throw new Error('workbench/missing-development-instruction');
      const confirmed = await client.ensureSession(entry.development.id, entry.development.revision, signal);
      const development = confirmed.development;
      if (!development.session || development.workbenchId !== entry.development.workbenchId || development.packageName !== entry.development.packageName)
        throw new Error('workbench/development-session-unconfirmed');
      signal?.throwIfAborted();
      props.onDevelopmentReady?.(development.id);
      const instruction = createWorkbenchDevelopmentInstruction(saved, development);
      signal?.throwIfAborted();
      if(props.onDraftPrepared){props.onDraftPrepared(confirmed,instruction);return;}
      await handoffNativeWorkbenchDraft(props.native, development.session.sessionId as Parameters<ISessions['retain']>[0], instruction, signal);
    }} />;
}
