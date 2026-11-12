import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { ASSET_SIGNATURE_REASONS, assetSignatureMessage } from 'workdsh-asset-signature';
import { SkillMarketRequestError } from '../market.js';
import type { SkillMarket } from './market-entry.js';
import { SkillListingRequestError, type SkillListing } from './listing-entry.js';
import type { SkillBatchItemResult, SkillInstallScope, SkillManagementEndpoint, SkillManagementService } from '../shared.js';
import { skillCatalogIconPath } from './catalog.js';
import { SIGNATURE_REINSTALL_MESSAGE } from './asset-signatures.js';

export const skillManagementPath = '/api/workdsh-skills';
export const skillImportPath = '/api/workdsh-skills/import';
export const skillListingUploadPath = '/api/workdsh-skills/listing-upload';
const maximumBodyBytes = 1024 * 1024 + 64 * 1024;
const maximumUploadBytes = 50 * 1024 * 1024;
/** 图标上传上限：与表单约定保持一致（≤2 MiB 的 png/jpeg）。 */
const maximumIconBytes = 2 * 1024 * 1024;

const ok = <T>(value: T): ConnectionRpcResult<T> => ({ ok: true, value });
const fail = (code: string, message: string): ConnectionRpcResult<never> => ({ ok: false, error: { code, message, details: {} } });
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const nameFrom = (payload: unknown): string | undefined => typeof record(payload)?.name === 'string' ? record(payload)?.name as string : undefined;

/**
 * 资产闸门是可选宿主能力：插件未安装、闸门关闭或该类型未开启时，下面三个函数完全透明，
 * 不解析身份、不读快照、也不改变任何返回结果。判定本身由 asset-gate 的纯函数完成。
 */
type GateAssetType = 'skill' | 'mcp' | 'expert' | 'expert_group' | 'model' | 'prompt';
/** 审计动作：数据层只上报这五种关键写操作。 */
type GateAuditAction = 'install' | 'enable' | 'restore' | 'uninstall' | 'delete';
interface GateAuditWriteInput {
  readonly action: GateAuditAction;
  readonly assetType?: string;
  readonly assetId?: string;
  readonly assetName?: string;
  readonly succeeded: boolean;
  readonly reasonCode?: string;
  readonly failReason?: string;
}
interface AssetGateLike {
  enabled(assetType: GateAssetType): boolean;
  /** 主闸门与验签开关是否同时开启；旧版闸门没有该方法时按关闭处理。 */
  signatureEnabled?(): boolean;
  /** 触发式校验：进市场页/刷新/写操作完成后做一次 revision 比对；旧版闸门没有该方法时跳过。 */
  refreshNow?(): Promise<void>;
  decide(request: { assetType: GateAssetType; assetId: string; usage: 'read' | 'use' | 'write' }): Promise<{ allow: boolean; reason: string; message: string }>;
  /** 拿不到后台编号时的拒绝结果：原因码与文案由闸门统一维护。 */
  unlisted(): { reason: string; message: string };
  /** 摘要校验不通过时的原因码与文案，同样由闸门统一维护。 */
  integrityMismatch(): { reason: string; message: string };
  /** 拒绝审计只入队；闸门关闭或上报异常都由实现自行吞掉。 */
  auditDenied?(input: {
    readonly layer: 'data_layer' | 'install_verify';
    readonly reasonCode: string;
    readonly action?: GateAuditAction;
    readonly assetType?: string;
    readonly assetId?: string;
    readonly assetName?: string;
  }): void;
  /** 关键写操作审计；同样只入队、不阻断业务。 */
  auditWrite?(input: GateAuditWriteInput): void;
}
const assetGate = (ctx: Context): AssetGateLike | undefined => ctx.reflect.get('workdshAssetGate') as AssetGateLike | undefined;

/** 拒绝时保留稳定原因码（gate/denied-*）与集中维护的文案，UI 据此区分「未授权」与「后台失败」。 */
class AssetGateDenied extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** 签名校验失败记 install_verify，其余数据层拒绝维持 data_layer。 */
    readonly layer: 'data_layer' | 'install_verify' = 'data_layer',
  ) {
    super(message);
    this.name = 'AssetGateDenied';
  }
}

/** 写操作（安装、启用）前判授权；闸门关闭时直接放行。 */
async function requireAsset(ctx: Context, assetType: GateAssetType, assetId: string): Promise<void> {
  const gate = assetGate(ctx);
  if (!gate?.enabled(assetType)) return;
  const decision = await gate.decide({ assetType, assetId, usage: 'write' });
  if (!decision.allow) throw new AssetGateDenied(decision.reason, decision.message);
}

/** 列表二次过滤：只保留授权命中的条目；闸门关闭时原样返回同一个数组。 */
async function visibleAssets<T>(ctx: Context, assetType: GateAssetType, rows: readonly T[], idOf: (row: T) => string | undefined): Promise<readonly T[]> {
  const gate = assetGate(ctx);
  if (!gate?.enabled(assetType)) return rows;
  // 进入市场页签/刷新/写操作后都会走到这里：先做一次 revision 校验（单飞 + 节流），
  // 保证后台刚授权或刚撤权的条目立刻反映到列表上，而不是等下一个周期。
  await gate.refreshNow?.();
  const visible: T[] = [];
  for (const row of rows) {
    const id = idOf(row);
    if (id === undefined) continue;
    if ((await gate.decide({ assetType, assetId: id, usage: 'read' })).allow) visible.push(row);
  }
  return visible;
}

/**
 * 启用前判定：只看技能目录内的安装清单。
 * 清单来源 market + 后台编号 → 先做完整性校验（验签开关开启时先验签、再比文件集合，mtime 不参与），
 * 通过后再判授权；builtin → 只做完整性校验（带签名块必验签、无签名块比内容），不参与授权过滤；
 * 没有清单或来源 local（用户自建/导入）→ 按「未上架/未登记」拒绝。
 * 验签开关只决定「市场来源缺签名」是否放行；清单里已有签名块时，开关关闭也必须验。
 */
async function requireSkillEnable(ctx: Context, manager: SkillManagementService, name: string): Promise<void> {
  const gate = assetGate(ctx);
  const manifest = await manager.installManifest?.(name);
  if (manifest?.source === 'market') {
    const signature = gate?.signatureEnabled?.() === true;
    const integrity = await manager.verifyInstalledIntegrity?.(name, { signature });
    if (integrity && !integrity.ok && integrity.reason !== 'missing') {
      const code = signatureIntegrityCode(integrity.reason);
      if (code) {
        // 缺少签名（装于关闭期间/缓存丢失）不是篡改，提示用户重新安装即可。
        const message = integrity.reason === 'signature-missing' ? SIGNATURE_REINSTALL_MESSAGE : assetSignatureMessage(code);
        throw new AssetGateDenied(code, message, 'install_verify');
      }
    }
    if (gate?.enabled('skill') !== true) return;
    if (manifest.assetId) return requireAsset(ctx, 'skill', manifest.assetId);
    const denial = gate.unlisted();
    throw new AssetGateDenied(denial.reason, denial.message);
  }
  if (manifest?.source === 'builtin') {
    // 内置技能不参与授权过滤，但完整性必须校验：不再因为 source=builtin 直接放行。
    const integrity = await manager.verifyInstalledIntegrity?.(name, { signature: true });
    if (integrity && !integrity.ok && integrity.reason !== 'missing') {
      const code = signatureIntegrityCode(integrity.reason);
      if (code) throw new AssetGateDenied(code, assetSignatureMessage(code), 'install_verify');
    }
    return;
  }
  if (gate?.enabled('skill') !== true) return;
  const denial = gate.unlisted();
  throw new AssetGateDenied(denial.reason, denial.message);
}

/** 完整性校验结果 → 签名契约原因码。 */
export function signatureIntegrityCode(reason: string): string | undefined {
  switch (reason) {
    case 'signature-missing': return ASSET_SIGNATURE_REASONS.missing;
    case 'signature-invalid': return ASSET_SIGNATURE_REASONS.invalid;
    case 'signature-asset-mismatch': return ASSET_SIGNATURE_REASONS.assetMismatch;
    case 'manifest-mismatch': return ASSET_SIGNATURE_REASONS.manifestMismatch;
    case 'manifest-extra-file': return ASSET_SIGNATURE_REASONS.manifestExtraFile;
    // 签名资产的文件集合就是判决依据：文件缺失/摘要不符都归到「文件与签名记录不一致」。
    case 'file-missing':
    case 'digest-mismatch':
    case 'quick-mismatch': return ASSET_SIGNATURE_REASONS.manifestMismatch;
    default: return undefined;
  }
}

/** 写操作审计的共同元数据。 */
interface WriteAuditMeta {
  readonly action: GateAuditAction;
  readonly assetType?: string;
  readonly assetId?: string;
  readonly assetName?: string;
}

/** 审计异常一律吞掉，绝不影响技能管理业务。 */
function auditWrite(ctx: Context, meta: WriteAuditMeta, succeeded: boolean, failure?: unknown): void {
  try {
    assetGate(ctx)?.auditWrite?.({
      ...meta,
      succeeded,
      ...(succeeded ? {} : { failReason: failure instanceof Error ? failure.message : String(failure ?? '') }),
    });
  } catch {
    // 审计是实现侧可选的旁路，失败不向调用方抛出。
  }
}

function auditDenied(ctx: Context, meta: WriteAuditMeta, reasonCode: string, layer: 'data_layer' | 'install_verify' = 'data_layer'): void {
  try {
    assetGate(ctx)?.auditDenied?.({ layer, reasonCode, ...meta });
  } catch {
    // 同上。
  }
}

/**
 * 包住一次关键写操作：成功记 `write/success`，失败记 `write/failed`，
 * 被闸门拒绝时记 `denied`（带 action 与原因码）。
 */
async function auditedWrite<T>(ctx: Context, meta: WriteAuditMeta, run: () => Promise<T>): Promise<T> {
  try {
    const value = await run();
    auditWrite(ctx, meta, true);
    return value;
  } catch (error) {
    if (error instanceof AssetGateDenied) auditDenied(ctx, meta, error.code, error.layer);
    else auditWrite(ctx, meta, false, error);
    throw error;
  }
}

/**
 * 本机卸载后的资产操作记录：只上报从市场安装过的技能（按安装记录反查市场条目 id），
 * 非市场技能与上报失败都只返回 false，不影响本机卸载结果。
 */
async function reportUninstall(ctx: Context, name: string, failure?: unknown): Promise<boolean> {
  try {
    const market = ctx.workdshSkillMarket as SkillMarket | undefined;
    if (!market) return false;
    const outcome = await market.uninstall({
      name,
      ...(failure === undefined ? { result: 'success' as const } : {
        result: 'failed' as const,
        failReason: 'other' as const,
        detail: failure instanceof Error ? failure.message : String(failure),
      }),
    });
    return outcome.reported;
  } catch {
    return false;
  }
}

function publicFailure(error: unknown): ConnectionRpcResult<never> {
  if (error instanceof DOMException && error.name === 'AbortError') return fail('skill/request-cancelled', '操作已取消。');
  if (error instanceof AssetGateDenied) return fail(error.code, error.message);
  if (error instanceof SkillMarketRequestError) return fail(error.code, error.message);
  // 上架申请服务的错误码与文案在服务内已经归一，直接透传，避免再维护一份映射表。
  if (error instanceof SkillListingRequestError) return fail(error.code, error.message);
  const code = error instanceof Error && error.message.startsWith('skill/') ? error.message : 'skill/internal';
  const messages: Record<string, string> = {
    'skill/invalid-name': '技能名称无效。',
    'skill/not-manageable': '该技能由只读来源提供，不能修改。',
    'skill/revision-conflict': '技能已被其他进程修改，请重新加载后再保存。',
    'skill/name-mismatch': 'SKILL.md 中的名称与当前技能不一致。',
    'skill/description-required': 'SKILL.md 必须包含 description。',
    'skill/invalid-frontmatter': 'SKILL.md 必须包含有效的 YAML frontmatter。',
    'skill/not-disabled': '技能当前不是停用状态。',
    'skill/target-exists': '目标位置已存在同名技能。',
    'skill/reload-failed': '保存后重新发现技能失败。',
    'skill/path-symlink': '技能路径包含不安全的符号链接。',
    'skill/path-outside-managed-roots': '技能路径不在受控目录中。',
    'skill/invalid-resource-path': '资源文件路径无效。',
    'skill/resource-too-large': '资源文件超过 1 MiB 上限。',
    'skill/resource-not-text': '该资源不是 UTF-8 文本，不能在此编辑。',
    'skill/document-too-large': 'SKILL.md 超过 1 MiB 上限。',
    'skill/busy': '该技能正在被其他操作修改，请稍后重试。',
    'skill/invalid-trash-id': '回收记录无效。',
    'skill/trash-not-found': '未找到可恢复的技能。',
    'skill/import-file-type': '仅支持 .zip 压缩包或 .md 技能文档。',
    'skill/import-empty': '上传的文件为空。',
    'skill/import-too-large': '技能包超过限制：最多 50 MiB、400 个文件、6 层资源目录。',
    'skill/import-too-deep': '技能包目录层级超过 6 层。',
    'skill/import-symlink': '技能包包含不安全的符号链接。',
    'skill/import-unsafe-path': '技能包包含越界或无效路径。',
    'skill/import-duplicate-path': '技能包包含重复文件路径。',
    'skill/import-multiple-skills': '一个压缩包只能包含一个 SKILL.md。',
    'skill/import-missing-skill-md': '技能包必须包含 SKILL.md。',
    'skill/import-invalid-id': '导入凭据无效。',
    'skill/import-expired': '导入预检已过期，请重新选择文件。',
    'skill/import-verification-failed': '安装前复核失败，请重新导入。',
    'skill/import-invalid-zip': '压缩包无效或使用了不支持的压缩格式。',
    'skill/invalid-batch': '批量操作必须包含 1 至 100 个有效技能。',
    'skill/dependency-impact-changed': '技能依赖关系已变化，请重新确认后再卸载。',
    'skill/dependency-blocked': '仍有对象依赖该技能，解除依赖后才能卸载。',
    'skill/catalog-entry-unknown': '本地技能目录中没有该技能。',
    'skill/catalog-entry-over-limit': '该技能的体积或文件数超过导入上限，不能从目录安装。',
    'skill/catalog-payload-missing': '本地技能目录缺少该技能的安装负载，请重新生成目录。',
    'skill/market-file-missing': '该技能缺少技能说明文件，不能安装。',
    'skill/market-file-unavailable': '技能文件下载失败，请检查网络后重试。',
    'skill/market-file-too-large': '技能文件超过 50 MiB 上限，不能安装。',
    'skill/market-item-unknown': '市场条目信息已失效，请刷新技能市场后重试。',
    'skill/market-unavailable': '当前环境未接入技能市场。',
    'skill/listing-upload-empty': '上传的文件为空。',
    'skill/listing-upload-too-large': '图标不得超过 2 MiB。',
  };
  return fail(code, messages[code] ?? '技能操作失败，请重试。');
}

/** 市场分页参数：缺省表示交给后台取默认值，出现非法值则拒绝请求。 */
const optionalCount = (value: unknown): number | undefined | null =>
  value === undefined ? undefined : typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
/** 市场文本参数：缺省表示不过滤，出现非字符串则拒绝请求。 */
const optionalText = (value: unknown): string | undefined | null => value === undefined ? undefined : typeof value === 'string' ? value : null;

async function dispatch(ctx: Context, manager: SkillManagementService, marketService: () => SkillMarket | undefined, listingService: () => SkillListing | undefined, rawEndpoint: unknown, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcResult<unknown>> {
  if (typeof rawEndpoint !== 'string') return fail('skill/invalid-request', '技能管理操作无效。');
  const endpoint = rawEndpoint as SkillManagementEndpoint;
  const market = (): SkillMarket => {
    const service = marketService();
    if (!service) throw new SkillMarketRequestError('skill/market-unavailable', '当前环境未接入技能市场。');
    return service;
  };
  const listing = (): SkillListing => {
    const service = listingService();
    if (!service) throw new SkillListingRequestError('skill/listing-unavailable', '当前环境未接入技能上架申请服务。');
    return service;
  };
  try {
    if (endpoint === 'list') return ok(await manager.list(signal));
    if (endpoint === 'catalog') return ok(await manager.catalog(signal));
    if (endpoint === 'trash-list') return ok(await manager.listTrash());
    if (endpoint === 'restore') {
      const id = record(payload)?.id;
      if (typeof id !== 'string') return fail('skill/invalid-request', '回收记录无效。');
      return ok(await auditedWrite(ctx, { action: 'restore', assetType: 'skill', assetId: id }, () => manager.restore(id)));
    }
    if (endpoint === 'commit-import') {
      const input = record(payload); const id = input?.id; const scope = input?.scope;
      if (typeof id !== 'string' || (scope !== undefined && scope !== 'shared-agents' && scope !== 'profile')) return fail('skill/invalid-request', '导入范围或凭据无效。');
      return ok(await auditedWrite(ctx, { action: 'install', assetType: 'skill' }, () => manager.imports.commit(id, scope as SkillInstallScope | undefined, signal)));
    }
    if (endpoint === 'discard-import') {
      const id = record(payload)?.id;
      if (typeof id !== 'string') return fail('skill/invalid-request', '导入凭据无效。');
      await manager.imports.discard(id); return ok(null);
    }
    if (endpoint === 'batch') {
      const input = record(payload); const names = input?.names; const action = input?.action;
      if (!Array.isArray(names) || !names.every(name => typeof name === 'string') || (action !== 'enable' && action !== 'disable' && action !== 'uninstall')) return fail('skill/invalid-request', '批量技能操作无效。');
      // 启用需要判授权；禁用与卸载始终放行。
      // 逐条判定：被拒的条目单条失败，其余条目仍按原批量结果返回。
      if (action === 'enable') {
        const denied: SkillBatchItemResult[] = [];
        const allowed: string[] = [];
        for (const name of names) {
          try {
            await requireSkillEnable(ctx, manager, name);
            allowed.push(name);
          } catch (error) {
            if (!(error instanceof AssetGateDenied)) throw error;
            // 被拒的条目记 denied（带 action 与原因码），不产生 write 事件。
            auditDenied(ctx, { action: 'enable', assetType: 'skill', assetName: name }, error.code, error.layer);
            denied.push({ name, ok: false, error: error.code });
          }
        }
        // 批量结果逐条记 write：成功 success、失败 failed 并带原因。
        const runBatch = async (batchNames: readonly string[]): Promise<{ results: readonly SkillBatchItemResult[] }> => {
          try {
            const result = await manager.batch({ names: batchNames, action });
            for (const item of result.results) {
              auditWrite(ctx, { action: 'enable', assetType: 'skill', assetName: item.name }, item.ok, item.ok ? undefined : item.error);
            }
            return result;
          } catch (error) {
            for (const name of batchNames) auditWrite(ctx, { action: 'enable', assetType: 'skill', assetName: name }, false, error);
            throw error;
          }
        };
        if (!denied.length) return ok(await runBatch(names));
        const rest = allowed.length ? await runBatch(allowed) : { results: [] as readonly SkillBatchItemResult[] };
        return ok({ action, results: [...denied, ...rest.results] });
      }
      return ok(await manager.batch({ names, action }));
    }
    // 技能上架申请：表单字典一次取回；列表与提交的参数在宿主侧校验后再转后台。
    if (endpoint === 'listing-options') return ok(await listing().options(signal));
    if (endpoint === 'listing-list') {
      const page = optionalCount(record(payload)?.page); const pageSize = optionalCount(record(payload)?.pageSize);
      const status = optionalText(record(payload)?.status); const keyword = optionalText(record(payload)?.keyword);
      if (page === null || pageSize === null || status === null || keyword === null) return fail('skill/invalid-request', '我的申请查询参数无效。');
      return ok(await listing().list({ page, pageSize, status, keyword }, signal));
    }
    if (endpoint === 'listing-submit') {
      const input = record(payload);
      const required = ['skillName', 'skillNameEn', 'skillVersion', 'skillType', 'bizScene', 'sourceNode', 'skillDescr', 'reason', 'isPublic', 'stagedId'] as const;
      if (!input || required.some(key => typeof input[key] !== 'string' || !(input[key] as string).trim())) return fail('skill/invalid-request', '上架申请缺少必填项。');
      if (typeof input.customTag !== 'string' || (input.icon !== undefined && typeof input.icon !== 'string')) return fail('skill/invalid-request', '上架申请的标签或图标无效。');
      const bounded = (key: string, limit: number): boolean => typeof input[key] !== 'string' || (input[key] as string).length <= limit;
      if (!bounded('skillName', 200) || !bounded('skillNameEn', 200) || !bounded('skillVersion', 64) || !bounded('skillDescr', 4000)
        || !bounded('reason', 4000) || !bounded('bizScene', 8192) || !bounded('sourceNode', 8192) || !bounded('customTag', 8192) || !bounded('icon', 8192))
        return fail('skill/invalid-request', '上架申请字段超出长度限制。');
      return ok(await listing().submit({
        skillName: input.skillName as string,
        skillNameEn: input.skillNameEn as string,
        skillVersion: input.skillVersion as string,
        skillType: input.skillType as string,
        bizScene: input.bizScene as string,
        sourceNode: input.sourceNode as string,
        skillDescr: input.skillDescr as string,
        customTag: input.customTag as string,
        reason: input.reason as string,
        isPublic: input.isPublic as string,
        ...(typeof input.icon === 'string' && input.icon.trim() ? { icon: input.icon.trim() } : {}),
        stagedId: input.stagedId as string,
      }, signal));
    }
    if (endpoint === 'listing-sso') {
      const input = record(payload);
      const menuId = input?.menuId;
      const box = record(input?.bizParams);
      if (typeof menuId !== 'string' || !/^\d{10,25}$/u.test(menuId) || !box) return fail('skill/invalid-request', '单点登录参数不完整。');
      const bizParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(box)) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) || typeof value !== 'string' || !value.trim() || value.length > 200) {
          return fail('skill/invalid-request', '单点登录业务参数不合法。');
        }
        bizParams[key] = value;
      }
      return ok(await listing().adminSsoTarget(menuId, bizParams, signal));
    }
    // 技能市场：业务场景与关键词都由服务端筛选，参数非法直接拒绝，不把错误取值带给后台。
    if (endpoint === 'market-available') {
      const service = marketService();
      return ok({ available: service ? await service.available() : false });
    }
    if (endpoint === 'market-list') {
      const page = optionalCount(record(payload)?.page); const pageSize = optionalCount(record(payload)?.pageSize);
      const scene = optionalText(record(payload)?.scene); const keyword = optionalText(record(payload)?.keyword);
      const builtin = record(payload)?.builtin;
      if (page === null || pageSize === null || scene === null || keyword === null || (builtin !== undefined && typeof builtin !== 'boolean')) return fail('skill/invalid-request', '技能市场查询参数无效。');
      const result = await market().list({ page, pageSize, scene, keyword, ...(typeof builtin === 'boolean' ? { builtin } : {}) }, signal);
      return ok({ ...result, items: await visibleAssets(ctx, 'skill', result.items, item => item.id) });
    }
    if (endpoint === 'market-categories') return ok(await market().categories(signal));
    if (endpoint === 'market-index') {
      const refresh = record(payload)?.refresh;
      if (refresh !== undefined && typeof refresh !== 'boolean') return fail('skill/invalid-request', '技能市场索引请求参数无效。');
      const rows = await market().index(signal, refresh === true);
      return ok(await visibleAssets(ctx, 'skill', rows, row => row.id));
    }
    if (endpoint === 'market-install' && typeof record(payload)?.id === 'string' && (record(payload)?.id as string).trim()) {
      const id = record(payload)?.id as string;
      const meta = { action: 'install', assetType: 'skill', assetId: id.trim() } as const;
      return ok(await auditedWrite(ctx, meta, async () => {
        await requireAsset(ctx, 'skill', id.trim());
        return market().install(id, signal);
      }));
    }
    // 详情页说明：宿主下载附件并取出 SKILL.md 正文（md 直读，zip 解包）。
    if (endpoint === 'market-document' && typeof record(payload)?.id === 'string' && (record(payload)?.id as string).trim()) {
      return ok(await market().document(record(payload)?.id as string, signal));
    }
    const name = nameFrom(payload);
    if (!name) return fail('skill/invalid-request', '请求缺少有效的技能名称。');
    if (endpoint === 'detail') {
      const detail = await manager.detail(name, signal);
      return detail ? ok(detail) : fail('skill/not-found', '未找到该技能。');
    }
    if (endpoint === 'update') {
      const input = record(payload);
      if (typeof input?.document !== 'string' || input.document.length > 1024 * 1024 || typeof input.expectedRevision !== 'string') {
        return fail('skill/invalid-request', '技能文档或版本信息无效。');
      }
      return ok(await manager.update({ name, document: input.document, expectedRevision: input.expectedRevision }));
    }
    if (endpoint === 'resource') {
      const resourcePath = record(payload)?.path;
      if (typeof resourcePath !== 'string') return fail('skill/invalid-request', '资源文件路径无效。');
      return ok(await manager.readResource(name, resourcePath));
    }
    if (endpoint === 'write-resource') {
      const input = record(payload);
      if (typeof input?.path !== 'string' || typeof input.document !== 'string' || input.document.length > 1024 * 1024 || (input.expectedRevision !== undefined && typeof input.expectedRevision !== 'string')) {
        return fail('skill/invalid-request', '资源文件内容或版本信息无效。');
      }
      return ok(await manager.writeResource({ name, path: input.path, document: input.document, expectedRevision: input.expectedRevision as string | undefined }));
    }
    if (endpoint === 'set-enabled') {
      const enabled = record(payload)?.enabled;
      if (typeof enabled !== 'boolean') return fail('skill/invalid-request', '启用状态无效。');
      // 启用判授权并记关键写操作；禁用不属于审计动作，直接放行。
      if (!enabled) return ok(await manager.setEnabled(name, false));
      const meta = { action: 'enable', assetType: 'skill', assetName: name } as const;
      return ok(await auditedWrite(ctx, meta, async () => {
        await requireSkillEnable(ctx, manager, name);
        return manager.setEnabled(name, true);
      }));
    }
    if (endpoint === 'install-catalog') {
      const scope = record(payload)?.scope;
      if (scope !== undefined && scope !== 'shared-agents' && scope !== 'profile') return fail('skill/invalid-request', '安装范围无效。');
      return ok(await auditedWrite(ctx, { action: 'install', assetType: 'skill', assetName: name }, () => manager.installFromCatalog(name, scope as SkillInstallScope | undefined, signal)));
    }
    if (endpoint === 'dependency-impact') return ok(await manager.dependencyImpact(name));
    if (endpoint === 'uninstall') {
      const expectedImpactRevision = record(payload)?.expectedImpactRevision;
      if (typeof expectedImpactRevision !== 'string') return fail('skill/invalid-request', '卸载前必须确认最新依赖影响。');
      try {
        const receipt = await auditedWrite(ctx, { action: 'uninstall', assetType: 'skill', assetName: name }, () => manager.uninstall(name, expectedImpactRevision));
        // 本机卸载成功后再补一条资产操作记录；市场来源由安装记录反查，非市场技能自动跳过。
        return ok({ ...receipt, reported: await reportUninstall(ctx, name) });
      } catch (error) {
        // 本机卸载失败也如实上报，但上报失败不影响把本地错误抛给界面。
        await reportUninstall(ctx, name, error);
        throw error;
      }
    }
    return fail('skill/unknown-endpoint', '未知的技能管理操作。');
  } catch (error) {
    return publicFailure(error);
  }
}

function json(result: ConnectionRpcResult<unknown>, status = 200): Response {
  return Response.json(result, { status, headers: { 'cache-control': 'no-store' } });
}

/** 有上限地读完整份上传体：图标等小文件在宿主内存里直接转交后台上传接口。 */
async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) throw new Error('skill/listing-upload-empty');
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) throw new Error('skill/listing-upload-too-large');
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  if (!total) throw new Error('skill/listing-upload-empty');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

/** Register the management API inside Connection's authenticated `/api` carrier. */
export function registerSkillManagementConnection(ctx: Context): void {
  const connection = (ctx as Context & { connection: HostConnectionHandle }).connection;
  const manager = ctx.workdshSkills;
  /** 市场服务是可选注入的宿主能力：缺失时市场端点明确返回「未接入」，不影响本地技能管理。 */
  const marketService = (): SkillMarket | undefined => ctx.reflect.get('workdshSkillMarket') as SkillMarket | undefined;
  /** 上架申请服务同样是可选能力：个人模式或未接入后台时整条链路不可用。 */
  const listingService = (): SkillListing | undefined => ctx.reflect.get('workdshSkillListing') as SkillListing | undefined;
  const lifetime = new AbortController();
  const pending = new Set<Promise<Response>>();
  const handle = (fetcher: (request: Request) => Promise<Response>) => (request: Request) => {
    if (lifetime.signal.aborted) return Promise.resolve(json(fail('skill/unavailable', '技能管理已停止。'), 503));
    const current = new Request(request, { signal: AbortSignal.any([request.signal, lifetime.signal]) });
    const operation = fetcher(current);
    pending.add(operation);
    void operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  // Unregister, abort and drain in one disposer: a removed feature must not
  // leave an upload or management write executing after dispose has completed.
  const unregister: Array<() => Promise<void>> = [];
  ctx.effect(() => async () => {
    lifetime.abort();
    await Promise.all(unregister.map(dispose => dispose()));
    await Promise.allSettled([...pending]);
  }, 'workdsh.skills.fetch');
  unregister.push(connection.fetch.register({
    path: skillManagementPath,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: handle(async request => {
      const declaredLength = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) return json(fail('skill/request-too-large', '技能管理请求过大。'), 413);
      try {
        const text = await request.text();
        if (text.length > maximumBodyBytes) return json(fail('skill/request-too-large', '技能管理请求过大。'), 413);
        const body = record(JSON.parse(text));
        if (!body) return json(fail('skill/invalid-request', '技能管理请求格式无效。'), 400);
        return json(await dispatch(ctx, manager, marketService, listingService, body.endpoint, body.payload, request.signal));
      } catch (error) {
        if (error instanceof SyntaxError) return json(fail('skill/invalid-request', '技能管理请求格式无效。'), 400);
        return json(publicFailure(error));
      }
    }),
  }));
  unregister.push(connection.fetch.register({
    // Browser-native icon delivery: query parameters stay available on the request
    // URL, and the immutable revision in the URL keeps catalog caching honest.
    path: skillCatalogIconPath,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: handle(async request => {
      const name = new URL(request.url).searchParams.get('name');
      if (!name) return new Response('缺少技能名称。', { status: 400 });
      try {
        const icon = await manager.readCatalogIcon(name);
        if (!icon) return new Response('未找到图标。', { status: 404 });
        // A fresh ArrayBuffer-backed view satisfies `BodyInit`.
        const bytes = new Uint8Array(icon.bytes);
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': icon.contentType, 'content-length': String(bytes.byteLength), 'cache-control': 'private, max-age=31536000, immutable' },
        });
      } catch { return new Response('未找到图标。', { status: 404 }); }
    }),
  }));
  unregister.push(connection.fetch.register({
    path: skillImportPath,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: handle(async request => {
      const declaredLength = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredLength) && declaredLength > maximumUploadBytes) return json(fail('skill/import-too-large', '技能包不得超过 50 MiB。'), 413);
      const encodedName = request.headers.get('x-workdsh-file-name');
      if (!encodedName) return json(fail('skill/invalid-request', '请求缺少文件名。'), 400);
      try {
        const fileName = decodeURIComponent(encodedName);
        return json(ok(await manager.imports.stage(fileName, request.body, request.signal)));
      } catch (error) {
        return json(publicFailure(error));
      }
    }),
  }));
  unregister.push(connection.fetch.register({
    // 图标上传：渲染层把图片原始字节发到这里，宿主再转交后台上传接口，
    // 这样令牌与后台地址都不会进入渲染层。
    path: skillListingUploadPath,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: handle(async request => {
      const declaredLength = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredLength) && declaredLength > maximumIconBytes) return json(fail('skill/listing-upload-too-large', '图标不得超过 2 MiB。'), 413);
      const encodedName = request.headers.get('x-workdsh-file-name');
      if (!encodedName) return json(fail('skill/invalid-request', '请求缺少文件名。'), 400);
      const service = listingService();
      if (!service) return json(fail('skill/listing-unavailable', '当前环境未接入技能上架申请服务。'));
      try {
        const fileName = decodeURIComponent(encodedName);
        return json(ok(await service.upload(fileName, await readBounded(request.body, maximumIconBytes), request.signal)));
      } catch (error) {
        return json(publicFailure(error));
      }
    }),
  }));
}
