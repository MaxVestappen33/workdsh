import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';

export const libraryManagementPath = '/api/workdsh-library';
const ok = <T>(value: T): ConnectionRpcResult<T> => ({ ok: true, value });
const fail = (code: string, message: string): ConnectionRpcResult<never> => ({ ok: false, error: { code, message, details: {} } });
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function registerLibraryConnection(ctx: Context): void {
  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  const unregister = connection.fetch.register({
    path: libraryManagementPath, methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      try {
        const body = record(await request.json()); const endpoint = body?.endpoint; const payload = record(body?.payload) ?? {};
        const current = await ctx.workdshIdentity.resolve(undefined, request.signal); const manager = ctx.workdshLibrary;
        if (endpoint === 'space') return Response.json(ok(await manager.space(current, request.signal)));
        if (endpoint === 'list' && (payload.parentId === undefined || typeof payload.parentId === 'string')) return Response.json(ok(await manager.list(current, payload.parentId as string | undefined, request.signal)));
        if (endpoint === 'create-folder' && typeof payload.name === 'string' && (payload.parentId === undefined || typeof payload.parentId === 'string')) return Response.json(ok(await manager.createFolder(current, payload.name, payload.parentId as string | undefined, request.signal)));
        if (endpoint === 'import' && typeof payload.name === 'string' && typeof payload.base64 === 'string' && typeof payload.operationId === 'string') {
          return Response.json(ok(await manager.importAsset(current, { name: payload.name, bytes: Buffer.from(payload.base64, 'base64'), operationId: payload.operationId, ...(typeof payload.parentId === 'string' ? { parentId: payload.parentId } : {}), ...(typeof payload.mediaType === 'string' ? { mediaType: payload.mediaType } : {}) }, request.signal)));
        }
        if (endpoint === 'save-original-revision') {
          const keys=Object.keys(payload);
          if(keys.length!==4||keys.some(key=>!['assetId','expectedRevisionId','operationId','base64'].includes(key))||
             !['assetId','expectedRevisionId','operationId'].every(key=>typeof payload[key]==='string'&&(payload[key] as string).trim()&&(payload[key] as string).length<=256)||
             typeof payload.base64!=='string'||payload.base64.length>Math.ceil(50*1024*1024/3)*4||!payload.base64.length||payload.base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(payload.base64))
            return Response.json(fail('library/invalid-request','保存请求无效。'),{status:400});
          if(!manager.saveOriginalRevision)return Response.json(fail('library/revision-save-unavailable','原件版本保存服务尚未加载。'),{status:503});
          const bytes=Buffer.from(payload.base64,'base64');if(bytes.toString('base64')!==payload.base64)return Response.json(fail('library/invalid-request','文件编码无效。'),{status:400});
          const guard=()=>{request.signal.throwIfAborted();ctx.fiber.assertActive();const profile=ctx.workdshIdentity.profile();
            if(profile.principalId!==current.principalId||profile.organization.id!==current.organizationId||profile.resolvedBy!==current.resolvedBy||ctx.workdshIdentity.membership(current.organizationId,current.principalId)?.state!=='active')throw new Error('library/actor-changed');};
          guard();const value=await manager.saveOriginalRevision(current,{assetId:payload.assetId as string,expectedRevisionId:payload.expectedRevisionId as string,operationId:payload.operationId as string,bytes},request.signal,guard);guard();return Response.json(ok(value));
        }
        if (endpoint === 'search' && typeof payload.query === 'string') {
          const kinds = Array.isArray(payload.kinds) && payload.kinds.every(value => typeof value === 'string') ? payload.kinds : undefined;
          const sources = Array.isArray(payload.sources) && payload.sources.every(value => typeof value === 'string') ? payload.sources : undefined;
          return Response.json(ok(await manager.search(current, payload.query, { ...(kinds ? { kinds: kinds as never } : {}), ...(sources ? { sources: sources as never } : {}), ...(typeof payload.updatedAfter === 'string' ? { updatedAfter: payload.updatedAfter } : {}), ...(typeof payload.updatedBefore === 'string' ? { updatedBefore: payload.updatedBefore } : {}) }, request.signal)));
        }
        if (endpoint === 'task-selection' && typeof payload.sessionId === 'string') return Response.json(ok(await manager.taskSelection(current, payload.sessionId, request.signal)));
        if (endpoint === 'set-task-selection' && typeof payload.sessionId === 'string' && Array.isArray(payload.nodeIds) && payload.nodeIds.every(value => typeof value === 'string')) return Response.json(ok(await manager.setTaskSelection(current, payload.sessionId, payload.nodeIds, request.signal)));
        if (endpoint === 'create-draft' && typeof payload.assetId === 'string') return Response.json(ok(await manager.createDraft(current, payload.assetId, typeof payload.baseRevisionId === 'string' ? payload.baseRevisionId : undefined, request.signal)));
        if (endpoint === 'update-draft' && typeof payload.draftId === 'string' && typeof payload.content === 'string' && typeof payload.expectedRevision === 'string') return Response.json(ok(await manager.updateDraft(current, payload.draftId, payload.content, payload.expectedRevision, request.signal)));
        if (endpoint === 'publish-draft' && typeof payload.draftId === 'string' && typeof payload.expectedRevision === 'string') return Response.json(ok(await manager.publishDraft(current, payload.draftId, payload.expectedRevision, request.signal)));
        if (endpoint === 'set-asset-status' && typeof payload.assetId === 'string' && (payload.status === 'active' || payload.status === 'disabled')) return Response.json(ok(await manager.setAssetStatus(current, payload.assetId, payload.status, request.signal)));
        if (endpoint === 'read-text' && typeof payload.assetId === 'string') return Response.json(ok(await manager.readText(current, payload.assetId, typeof payload.revisionId === 'string' ? payload.revisionId : undefined, request.signal)));
        if (endpoint === 'original-file-path' && typeof payload.assetId === 'string' && typeof payload.revisionId === 'string') return Response.json(ok({path: await manager.originalFilePath(current, payload.assetId, payload.revisionId, request.signal)}));
        if (endpoint === 'read-original' && typeof payload.assetId === 'string') return Response.json(ok({ base64: Buffer.from(await manager.readOriginal(current, payload.assetId, typeof payload.revisionId === 'string' ? payload.revisionId : undefined, request.signal)).toString('base64') }));
        if (endpoint === 'rename' && typeof payload.nodeId === 'string' && typeof payload.name === 'string') return Response.json(ok(await manager.rename(current, payload.nodeId, payload.name, request.signal)));
        if (endpoint === 'move' && typeof payload.nodeId === 'string' && (payload.parentId === undefined || typeof payload.parentId === 'string')) return Response.json(ok(await manager.move(current, payload.nodeId, payload.parentId as string | undefined, request.signal)));
        if (endpoint === 'remove' && typeof payload.nodeId === 'string') { await manager.remove(current, payload.nodeId, request.signal); return Response.json(ok({ removed: true })); }
        return Response.json(fail('library/invalid-request', '资料库请求无效。'), { status: 400 });
      } catch (cause) {
        const code = cause instanceof Error && cause.message.startsWith('library/') ? cause.message : 'library/internal';
        const messages: Record<string, string> = { 'library/owner-mismatch': '资料空间归属不一致，无法执行操作。', 'library/asset-binding-mismatch': '资料与目录的关联不一致，无法读取。', 'library/revision-asset-mismatch': '所选版本不属于这份资料，请重新选择。', 'library/not-found': '资料不存在或无权访问。', 'library/disabled': '资料已停用，不能读取、检索或添加到任务。', 'library/name-conflict': '同一目录已有同名项目。', 'library/unsupported-format': '当前仅支持 Markdown、TXT、PDF、DOCX、PPTX、HTML、CSV 和 XLSX。', 'library/file-size': '文件为空或超过限制。', 'library/cycle': '文件夹不能移动到自己的子目录。', 'library/invalid-name': '资料名称无效。', 'library/revision-conflict': '草稿已被更新，请刷新后重试。', 'library/base-revision-conflict': '资料已有新版本，请重新读取后再保存。', 'library/draft-format': '第一版只支持修改 Markdown 和 TXT。', 'library/selection-too-large': '所选目录资料过多，请缩小范围。', 'library/invalid-csv': 'CSV 包含二进制内容，无法作为表格导入。', 'library/invalid-xlsx': 'XLSX 已损坏或格式与扩展名不符。', 'library/invalid-text': '文本不是有效的 UTF-8。', 'library/invalid-pdf': 'PDF 已损坏或格式与扩展名不符。', 'library/invalid-office-file': 'Office 文件已损坏或格式与扩展名不符。', 'library/invalid-docx': '文件不是有效的 DOCX。', 'library/invalid-pptx': '文件不是有效的 PPTX。', 'library/invalid-html': '文件不是有效的 HTML。', 'library/archive-limit': 'Office 文件解压规模或压缩比超过安全限制。', 'library/archive-path': 'Office 文件包含不安全的归档路径。' };
        return Response.json(fail(code, messages[code] ?? '资料库操作失败。'), { status: code === 'library/internal' ? 500 : code === 'library/actor-changed' ? 403 : ['library/base-revision-conflict','library/operation-conflict'].includes(code) ? 409 : 400 });
      }
    },
  });
  ctx.effect(() => unregister, 'workdsh.library.fetch');
}
