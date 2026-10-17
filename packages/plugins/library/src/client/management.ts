import {fileBase64} from './file-base64.js';
import type { Context } from '@deepseek-ai/cordis';
import type { LibraryOriginalRevisionInput, LibraryAssetStatus, LibraryDraft, LibraryNode, LibrarySearchFilters, LibrarySearchHit, LibrarySpace, LibraryTaskReference, LibraryTreeEntry } from 'workdsh-contracts/library';

const path = '/api/workdsh-library';
const invoke = async <T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> => {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const result = await response.json() as { ok?: boolean; value?: T; error?: { message?: string } };
  if (!result.ok) throw new Error(result.error?.message ?? '资料库操作失败。');
  return result.value as T;
};
const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export function createLibraryClient(_ctx: Context, lifetime?: AbortSignal) {
  return {
    space: () => invoke<LibrarySpace>('space', {}, lifetime),
    list: (parentId?: string) => invoke<readonly LibraryTreeEntry[]>('list', { parentId }, lifetime),
    createFolder: (name: string, parentId?: string) => invoke<LibraryNode>('create-folder', { name, parentId }, lifetime),
    importFile: async (file: File, parentId?: string) => invoke<LibraryTreeEntry>('import', { name: file.name, mediaType: file.type, parentId, base64: await fileBase64(file,lifetime), operationId: crypto.randomUUID() }, lifetime),
    saveOriginalRevision: async (input: LibraryOriginalRevisionInput, signal?: AbortSignal) => {
      const bytes=Uint8Array.from(input.bytes),request={...input,bytes},combined=AbortSignal.any([...(lifetime?[lifetime]:[]),...(signal?[signal]:[])]);
      combined.throwIfAborted();if(!bytes.byteLength||bytes.byteLength>50*1024*1024)throw new Error('library/file-size');
      const base64=await fileBase64(new File([bytes],'revision.bin'),combined);combined.throwIfAborted();
      const value=await invoke<LibraryTreeEntry>('save-original-revision',{assetId:request.assetId,expectedRevisionId:request.expectedRevisionId,operationId:request.operationId,base64},combined);
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');combined.throwIfAborted();
      if(!value.asset||!value.revision||value.asset.id!==request.assetId||value.revision.assetId!==request.assetId||value.revision.originalSha256!==hash||!value.revision.id||value.revision.id===request.expectedRevisionId)throw new Error('library/invalid-revision-receipt');
      return value;
    },
    search: (query: string, filters: LibrarySearchFilters = {}) => invoke<readonly LibrarySearchHit[]>('search', { query, ...filters }, lifetime),
    taskSelection: (sessionId: string) => invoke<readonly LibraryTaskReference[]>('task-selection', { sessionId }, lifetime),
    setTaskSelection: (sessionId: string, nodeIds: readonly string[]) => invoke<readonly LibraryTaskReference[]>('set-task-selection', { sessionId, nodeIds }, lifetime),
    createDraft: (assetId: string, baseRevisionId?: string) => invoke<LibraryDraft>('create-draft', { assetId, baseRevisionId }, lifetime),
    updateDraft: (draftId: string, content: string, expectedRevision: string) => invoke<LibraryDraft>('update-draft', { draftId, content, expectedRevision }, lifetime),
    publishDraft: (draftId: string, expectedRevision: string) => invoke<LibraryTreeEntry>('publish-draft', { draftId, expectedRevision }, lifetime),
    setAssetStatus: (assetId: string, status: LibraryAssetStatus) => invoke<LibraryTreeEntry>('set-asset-status', { assetId, status }, lifetime),
    readText: (assetId: string, revisionId?: string, signal?: AbortSignal) => invoke<string>('read-text', { assetId, revisionId }, signal ? AbortSignal.any([...(lifetime ? [lifetime] : []), signal]) : lifetime),
    originalFilePath: async (assetId: string, revisionId: string, signal?: AbortSignal) => (await invoke<{path:string}>('original-file-path', {assetId,revisionId}, signal ? AbortSignal.any([...(lifetime ? [lifetime] : []), signal]) : lifetime)).path,
    readOriginal: async (assetId: string, revisionId?: string, signal?: AbortSignal) => decodeBase64((await invoke<{ base64: string }>('read-original', { assetId, revisionId }, signal ? AbortSignal.any([...(lifetime ? [lifetime] : []), signal]) : lifetime)).base64),
    rename: (nodeId: string, name: string) => invoke<LibraryNode>('rename', { nodeId, name }, lifetime),
    move: (nodeId: string, parentId?: string) => invoke<LibraryNode>('move', { nodeId, parentId }, lifetime),
    remove: (nodeId: string) => invoke<{ removed: true }>('remove', { nodeId }, lifetime),
  };
}
export type LibraryClient = ReturnType<typeof createLibraryClient>;
