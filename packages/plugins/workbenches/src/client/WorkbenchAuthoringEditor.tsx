import React, { useMemo } from 'react';
import type { WorkbenchDevelopmentIndexEntry, WorkbenchRequirementsRevision } from 'workdsh-contracts';
import { WorkbenchRequirementsEditor } from './WorkbenchRequirementsEditor.js';
import { createWorkbenchDevelopmentClient } from './development-client.js';
import { prepareSavedWorkbenchDevelopment } from './authoring-controller.js';

export interface WorkbenchAuthoringEditorProps {
  readonly developmentId: string;
  readonly identityScopeKey: string;
  readonly workbenchId: string;
  readonly packageName: string;
  readonly onAssociated: (entry: WorkbenchDevelopmentIndexEntry, signal?: AbortSignal, instruction?: string, saved?: WorkbenchRequirementsRevision) => Promise<void>;
  readonly onCancel: () => void;
}
/** Stable plugin identity is supplied by the owning creation/restoration page.
 * Persisted requirements survive failures in development association or navigation.
 */
export function WorkbenchAuthoringEditor(props: WorkbenchAuthoringEditorProps) {
  const client = useMemo(() => createWorkbenchDevelopmentClient(), []);
  return <WorkbenchRequirementsEditor key={JSON.stringify([props.identityScopeKey, props.developmentId, props.workbenchId, props.packageName])}
    developmentId={props.developmentId} identityScopeKey={props.identityScopeKey} onCancel={props.onCancel}
    onSaved={async (saved, signal) => {
      const prepared = await prepareSavedWorkbenchDevelopment(client, saved, { workbenchId: props.workbenchId, packageName: props.packageName }, signal);
      signal?.throwIfAborted();
      await props.onAssociated(prepared.entry, signal, prepared.instruction, saved);
    }} />;
}
