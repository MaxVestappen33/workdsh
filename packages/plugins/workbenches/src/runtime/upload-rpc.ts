import { receiveWorkbenchArtifact } from './upload-artifact.js';
export const workbenchUploadPath = '/api/workdsh-workbench-upload';
export type WorkbenchUploadMetadata = { developmentId: string; packageName: string; version: string; workbenchId: string };
/** Raw binary endpoint. Metadata is bounded separately; no filesystem paths,
 * actor claims or installation targets are accepted or returned. */
export async function handleWorkbenchUploadRequest(request: Request, root: string,
  resolveAccess: (metadata: WorkbenchUploadMetadata, signal: AbortSignal) => Promise<() => void>) {
  const failure = (code: string, status: number) => Response.json({ ok: false, error: { code, message: '插件包上传未完成，请检查后重试。' } }, { status });
  if (request.method !== 'POST') return failure('workbench/invalid-method', 405);
  try {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/octet-stream' || !request.body)
      throw new Error('workbench/invalid-request');
    const header = request.headers.get('x-workdsh-upload');
    if (!header || header.length > 4096) throw new Error('workbench/invalid-request');
    let metadata: WorkbenchUploadMetadata;
    try {
      const value = JSON.parse(header);
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 ||
          !['developmentId', 'packageName', 'version', 'workbenchId'].every(key => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 214) ||
          !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value.packageName)) throw new Error();
      metadata = Object.freeze(value);
    } catch { throw new Error('workbench/invalid-request'); }
    const authorize = await resolveAccess(metadata, request.signal); authorize();
    const uploaded = await receiveWorkbenchArtifact(root, request.body, metadata, authorize, request.signal);
    authorize();
    return Response.json({ ok: true, value: { developmentId: metadata.developmentId,
      packageName: uploaded.expected.packageName, version: uploaded.expected.version,
      workbenchId: uploaded.expected.workbenchId, sha256: uploaded.expected.sha256 } });
  } catch (cause) {
    if (request.signal.aborted) return failure('workbench/request-cancelled', 408);
    const code = cause instanceof Error ? cause.message : '';
    if (['workbench/development-access-denied', 'workbench/development-owner-mismatch'].includes(code)) return failure(code, 403);
    if (code === 'workbench/package-archive-size-limit') return failure(code, 413);
    if (code === 'workbench/invalid-request') return failure(code, 400);
    if (/^workbench\/(?:invalid-upload|package-[a-z-]+|invalid-manifest|invalid-descriptor|invalid-id|one-workbench-per-package)$/.test(code)) return failure(code, 422);
    return failure('workbench/upload-failed', 500);
  }
}
