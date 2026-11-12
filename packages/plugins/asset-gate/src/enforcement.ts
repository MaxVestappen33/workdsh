/**
 * 资产闸门的调用期执行层：工具调用拦截 + 技能斜杠/技能清单过滤 + 模型请求拦截。
 *
 * 挂载点（均已按已安装的 `@deepseek-ai/*@0.2.1-rc.5` 类型定义核实）：
 * - `tools/pre-execute`：waterfall，返回 `{kind:'deny', reason, info}` 会变成模型可见的失败结果；
 *   必须 `await next()` 才能拿到内层与默认放行结果。
 * - `ctx.tools.guard`：同步、在全部 pre-execute 之后执行，只有拒绝没有允许，
 *   因此外层监听把 deny 翻成 allow 也挡不住它。它复用 pre-execute 的判定结果，保证两层口径一致。
 * - `agent/pre-step`：`prepend` 注册在最外层。官方 `dsh-tool-skill` 在 `await next()` 之后
 *   才追加技能目录与斜杠注入消息，只有比它更外层的监听才看得到这些消息。
 * - `agent/request`：waterfall，`next()` 给出最终 `provider`/`model`；返回替换配置或抛错。
 *   模型不是工具，`tools/pre-execute` 结构上覆盖不到，这是唯一能看到最终 route+model 的位置。
 *
 * 与 `packages/plugins/access` 的关系：access 的 pre-execute 负责用户/会话级工具白名单与审计，
 * 本模块只做「资产是否授权」，两者都调用 `next()`、互不短路；guard 只认本模块写入的判定结果。
 *
 * 零开销：闸门关闭时本模块不注册任何监听器——不解析身份、不读清单、不读快照。
 * 生效策略是运行时可变的，所以由 `workdsh/asset-gate/policy` 事件驱动「开则注册、关则注销」。
 *
 * 两个显式边界：
 * 1. `exec.agent` 为空（Host 内部调用）一律放行。闸门约束的是模型面：这类调用来自 Host 可信代码
 *    （探针、维护、插件内部编排），既不属于某个会话模型，也不该被资产准入卡死；
 *    与 access 插件 `if (!exec.agent) return next()` 的既有姿态一致。
 * 2. 闸门关闭时不注册钩子，而不是「注册后第一行返回 allow」。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import { GATE_REASONS, gateReasonMessage } from './reasons.js';

/** 闸门对外契约（结构类型，避免本模块依赖服务实现类）。 */
interface GateLike {
  enabled(assetType: 'mcp' | 'skill' | 'model'): boolean;
  /** 主闸门与验签子闸门是否同时开启；旧版闸门没有该方法时按关闭处理。 */
  signatureEnabled?(): boolean;
  decide(request: { readonly assetType: 'mcp' | 'skill' | 'model'; readonly assetId: string; readonly usage: 'use' }): Promise<{ readonly allow: boolean; readonly reason: string; readonly message: string }>;
  /** 工具级判定；旧版闸门没有该方法时按「不做工具级收窄」处理。 */
  decideTool?(request: { readonly assetId: string; readonly tool: string }): Promise<{ readonly allow: boolean; readonly reason: string; readonly message: string }>;
  /** 连接器的工具白名单；`restricted=false` 表示未收窄。 */
  mcpTools?(assetId: string): { readonly restricted: boolean; readonly tools: readonly string[] };
  unlisted(): { readonly reason: string; readonly message: string };
  /** 判定拒绝的审计入口；闸门关闭或上报异常都由实现自行吞掉。 */
  auditDenied?(input: {
    readonly layer: 'call_tool' | 'call_tool_item' | 'call_skill' | 'call_skill_inject' | 'call_model' | 'call_expert' | 'data_layer' | 'revocation' | 'write_action';
    readonly reasonCode: string;
    readonly assetType?: string;
    readonly assetId?: string;
    readonly assetName?: string;
    readonly toolName?: string;
  }): void;
}

/** 安装清单的形状：技能与连接器共用 source + assetId 两个关键字。 */
interface InstallManifestLike {
  readonly assetType?: string;
  readonly assetId?: string;
  readonly source?: string;
}

/** 调用期摘要校验结论：只关心 ok / 失败原因，文案与码由本模块映射。 */
interface DigestVerdictLike {
  readonly ok: boolean;
  readonly reason?: string;
}

interface SkillDirectoryLike {
  installManifest?(name: string): Promise<InstallManifestLike | undefined>;
  /** 可选：宿主未实现时按「无法校验」拒绝（验签子闸门开启且为市场来源时才会调用）。 */
  verifyInstalledDigests?(name: string): Promise<DigestVerdictLike>;
}

type ConnectorLookupLike =
  | {
    readonly found: false;
  }
  | {
    readonly found: true;
    readonly bundled?: boolean;
    readonly manifest?: InstallManifestLike;
    /**
     * 工具级信息，仅在连接器被白名单收窄时出现：
     * - `raw`：由白名单正向推出的原始工具名；
     * - `untrusted`：白名单无法推出该公共名，按映射不可信拒绝。
     */
    readonly tool?: { readonly raw?: string; readonly untrusted?: boolean };
  };

interface ConnectorDirectoryLike {
  connectorAssetForTool?(toolName: string): ConnectorLookupLike | undefined;
}

/** 模型安装记录反查结果：只取判定需要的来源与后台编号。 */
interface ModelInstallBasisLike {
  readonly kind?: unknown;
  readonly source?: unknown;
  readonly assetId?: unknown;
}

interface ModelDirectoryLike {
  installManifestOfModel?(route: string, modelCode: string): Promise<ModelInstallBasisLike | undefined>;
}

/** 一次判定结果：中文文案给模型看，稳定原因码只进 info.code。 */
interface GateDenial {
  readonly reason: string;
  readonly code: string;
  /** 审计用的资产归属（未登记时只有类型，没有编号）。 */
  readonly assetType?: 'mcp' | 'skill' | 'model';
  readonly assetId?: string;
  /** 审计层级；缺省按工具调用类型推导，工具级拒绝必须显式给 `call_tool_item`。 */
  readonly layer?: 'call_tool' | 'call_tool_item';
}

/** 判定过程抛异常时的统一拒绝：原因码与文案只从 reasons.ts 取，不复用「未授权」。 */
function evaluationDenial(): GateDenial {
  return {
    reason: gateReasonMessage(GATE_REASONS.deniedEvaluationError),
    code: GATE_REASONS.deniedEvaluationError,
  };
}

const SKILL_TOOL = 'skill';
const MCP_TOOL_PREFIX = 'mcp__';
/** guard 结果表上限：只记录被拒的执行，正常量级远小于该值。 */
const MAX_GUARD_ENTRIES = 64;

/**
 * 拦截期间的一次判定：pre-execute 写入，guard 同步读取。
 *
 * `ToolExecutionToken` 是 symbol（不是对象），`WeakMap` 不可用；用有界 Map 防止
 * 被取消、跳过的执行长期留痕。
 */
const denials = new Map<symbol, string>();

function remember(token: symbol, reason: string | undefined): void {
  if (reason === undefined) {
    denials.delete(token);
    return;
  }
  denials.set(token, reason);
  while (denials.size > MAX_GUARD_ENTRIES) {
    const oldest = denials.keys().next().value;
    if (oldest === undefined) break;
    denials.delete(oldest);
  }
}

/** 安装清单里的后台编号：去空白后非空才算存在。 */
function manifestAssetId(manifest: InstallManifestLike | undefined): string | undefined {
  return typeof manifest?.assetId === 'string' && manifest.assetId.trim() ? manifest.assetId.trim() : undefined;
}

/**
 * 唯一的资产判定口径（pre-execute 与 guard 共用，技能与 MCP 共用）：
 * - `market` + 后台编号 → 按编号判授权；
 * - `builtin` → 放行；
 * - 无清单或 `local`（用户自建/导入）→ 按「未上架/未登记」拒绝。
 */
async function judge(gate: GateLike, assetType: 'mcp' | 'skill', manifest: InstallManifestLike | undefined): Promise<GateDenial | undefined> {
  const assetId = manifestAssetId(manifest);
  if (manifest?.source === 'market' && assetId !== undefined) {
    const decision = await gate.decide({ assetType, assetId, usage: 'use' });
    return decision.allow ? undefined : { reason: decision.message, code: decision.reason, assetType, assetId };
  }
  if (manifest?.source === 'builtin') return undefined;
  const denial = gate.unlisted();
  return { reason: denial.message, code: denial.reason, assetType, ...(assetId ? { assetId } : {}) };
}

const argumentName = (value: unknown): string | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
};

/**
 * 调用期完整性校验：只在验签子闸门开启、且资产来源为市场时执行。
 *
 * 只比「磁盘文件清单摘要 vs 安装清单」，**不做 Ed25519 验签**：验签是安装/启用那道门的
 * 职责（缓存 envelope 与 24 小时新鲜期都属于那一步）。授权判定已经通过后才会走到这里，
 * 因此未授权的资产仍然返回 `denied-not-entitled`，不会因为内容问题改变拒绝语义。
 *
 * 边界：
 * - `builtin` 放行：随包发布，开发/打包环境会直接改文件，调用期校验只会误伤；
 * - `local` 到不了这里：上一步已按「未上架/未登记」拒绝；
 * - 市场来源没有签名块 → `denied-signature-missing`（装在验签关闭期，需重装）；
 * - 内容被改 / 清单损坏 / 宿主未提供校验能力 → `denied-integrity-broken`（fail-closed）。
 */
async function integrityDenial(
  ctx: Context,
  gate: GateLike,
  skills: SkillDirectoryLike | undefined,
  name: string,
  manifest: InstallManifestLike | undefined,
): Promise<GateDenial | undefined> {
  if (manifest?.source !== 'market') return undefined;
  if (gate.signatureEnabled?.() !== true) return undefined;
  const assetId = typeof manifest.assetId === 'string' && manifest.assetId.trim() ? manifest.assetId.trim() : undefined;
  const broken = (reasonCode: string): GateDenial => ({
    reason: gateReasonMessage(reasonCode), code: reasonCode, assetType: 'skill', ...(assetId ? { assetId } : {}),
  });
  const verify = skills?.verifyInstalledDigests;
  // 宿主没有摘要校验能力时不能假装校验过：按最小权限拒绝。
  if (typeof verify !== 'function') return broken(GATE_REASONS.deniedIntegrityBroken);
  let verdict: DigestVerdictLike;
  try {
    verdict = await verify.call(skills, name);
  } catch (error) {
    ctx.logger.warn(`资产闸门：技能完整性校验失败（${name}）：${error instanceof Error ? error.message : String(error)}。`);
    return broken(GATE_REASONS.deniedIntegrityBroken);
  }
  if (verdict.ok) return undefined;
  // 没有签名块（装在验签关闭期）与「有基准但对不上」分开报，便于用户按提示重装。
  return broken(verdict.reason === 'signature-missing' ? GATE_REASONS.deniedSignatureMissing : GATE_REASONS.deniedIntegrityBroken);
}

/** 解析一次工具调用对应的资产清单；返回 `undefined` 表示本模块不干预。 */
async function judgeTool(ctx: Context, gate: GateLike, exec: Readonly<ToolExecution>): Promise<GateDenial | undefined> {
  // 边界 1：Host 内部调用没有 agent，不属于模型面，放行（理由见文件头）。
  if (exec.agent === undefined) return undefined;

  if (exec.name === SKILL_TOOL) {
    if (!gate.enabled('skill')) return undefined;
    const name = argumentName(exec.arguments);
    // 没有技能名时交给工具自身校验参数，本模块不猜。
    if (name === undefined) return undefined;
    const skills = ctx.reflect.get('workdshSkills') as SkillDirectoryLike | undefined;
    // 目录形态读目录内清单、单文件形态读旁挂清单，摘要校验由技能服务完成。
    let manifest: InstallManifestLike | undefined;
    try {
      manifest = await skills?.installManifest?.(name);
    } catch (error) {
      // 清单读取失败无法判定授权：与闸门整体一致按未登记拒绝，不能当作放行。
      ctx.logger.warn(`资产闸门：技能清单读取失败（${name}）：${error instanceof Error ? error.message : String(error)}。`);
      const denial = gate.unlisted();
      return { reason: denial.message, code: denial.reason, assetType: 'skill' };
    }
    const denial = await judge(gate, 'skill', manifest);
    // 授权优先：未授权的拒绝语义不变，也不额外读盘。
    if (denial !== undefined) return denial;
    return integrityDenial(ctx, gate, skills, name, manifest);
  }

  if (!exec.name.startsWith(MCP_TOOL_PREFIX)) return undefined;
  if (!gate.enabled('mcp')) return undefined;
  const connectors = ctx.reflect.get('workdshConnectors') as ConnectorDirectoryLike | undefined;
  const lookup = connectors?.connectorAssetForTool?.(exec.name);
  // 没有对应连接器记录（工具随连接器删除后的残留调用）：放行，由工具自身报未知工具。
  if (lookup === undefined || lookup.found === false) return undefined;
  // 随包内置连接器与清单标了 builtin 的记录都放行。
  if (lookup.bundled === true) return undefined;
  const denial = await judge(gate, 'mcp', lookup.manifest);
  // 连接器级拒绝优先：语义仍是「整服务未授权」，不因工具明细改变。
  if (denial !== undefined) return denial;
  return judgeToolScope(gate, lookup, manifestAssetId(lookup.manifest));
}

/**
 * 工具级收窄：只在连接器被白名单限制、且目录能给出原始工具名时生效。
 *
 * - 目录没有工具信息（连接器未收窄 / 旧版连接器插件）→ 不做工具级判定；
 * - 白名单无法推出该公共名 → `denied-mapping-untrusted`（宁误拒不误放）；
 * - 否则按原始工具名走一次工具级判定，拒绝记 `call_tool_item`。
 */
async function judgeToolScope(gate: GateLike, lookup: ConnectorLookupLike, assetId: string | undefined): Promise<GateDenial | undefined> {
  if (lookup.found !== true || lookup.tool === undefined) return undefined;
  if (assetId === undefined) return undefined;
  if (lookup.tool.untrusted === true) {
    return {
      reason: gateReasonMessage(GATE_REASONS.deniedMappingUntrusted),
      code: GATE_REASONS.deniedMappingUntrusted,
      assetType: 'mcp',
      assetId,
      layer: 'call_tool_item',
    };
  }
  if (lookup.tool.raw === undefined || typeof gate.decideTool !== 'function') return undefined;
  const decision = await gate.decideTool({ assetId, tool: lookup.tool.raw });
  return decision.allow
    ? undefined
    : { reason: decision.message, code: decision.reason, assetType: 'mcp', assetId, layer: 'call_tool_item' };
}

/**
 * 注册工具调用拦截。
 *
 * pre-execute 负责产出拒绝结果并记住判定，guard 同步复述同一判定：
 * 即使别的插件在本监听外层把 `{kind:'deny'}` 改成 `{kind:'allow'}`，guard 仍然拒绝。
 */
function registerToolInterception(ctx: Context, gate: GateLike): () => void {
  const disposers: Array<() => unknown> = [];
  disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next();
    let denial: GateDenial | undefined;
    try {
      denial = await judgeTool(ctx, gate, exec);
    } catch (error) {
      // 判定异常一律按最小权限拒绝：与模型层、数据层保持同一姿态，不能放行。
      ctx.logger.warn(`资产闸门：工具判定失败（${exec.name}）：${error instanceof Error ? error.message : String(error)}。`);
      denial = evaluationDenial();
    }
    remember(exec.token, denial?.reason);
    if (denial !== undefined) {
      // 审计只入队，不影响本次调用耗时；实现侧会吞掉任何异常。
      gate.auditDenied?.({
        layer: denial.layer ?? (exec.name === SKILL_TOOL ? 'call_skill' : 'call_tool'),
        reasonCode: denial.code,
        ...(denial.assetType ? { assetType: denial.assetType } : {}),
        ...(denial.assetId ? { assetId: denial.assetId } : {}),
        toolName: exec.name,
      });
    }
    if (denial === undefined || decision.kind !== 'allow') return decision;
    return { kind: 'deny', reason: denial.reason, info: { name: 'asset-gate', code: denial.code } };
  }));

  const tools = ctx.reflect.get('tools') as { guard?(guard: (exec: Readonly<ToolExecution>) => string | undefined): () => unknown } | undefined;
  if (typeof tools?.guard === 'function') {
    disposers.push(tools.guard((exec) => denials.get(exec.token)));
  }
  return () => { for (const dispose of disposers) dispose(); };
}

/** 模型请求被拒：稳定原因码进 `code`，中文文案进 `message`（抛错即本轮请求失败）。 */
export class AssetGateModelDenied extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AssetGateModelDenied';
  }
}

/**
 * 模型资产判定：`route`（provider 路由名）+ `modelCode` 反查安装记录。
 *
 * - 查不到记录 → 用户在官方设置里自填 provider，按自建豁免放行；
 * - `custom`（本机自定义模型）→ 完全豁免，不看主闸门也不看子闸门；
 * - `market` + 后台编号 → 判授权；`market` 但无清单/编号 → 按未登记拒绝。
 */
async function judgeModel(
  ctx: Context,
  gate: GateLike,
  config: { readonly provider?: unknown; readonly model?: unknown },
): Promise<GateDenial | undefined> {
  const route = typeof config.provider === 'string' ? config.provider : '';
  const model = typeof config.model === 'string' ? config.model : '';
  if (!route || !model) return undefined;
  const directory = ctx.reflect.get('workdshModelMarket') as ModelDirectoryLike | undefined;
  if (typeof directory?.installManifestOfModel !== 'function') return undefined;
  let record: ModelInstallBasisLike | undefined;
  try {
    record = await directory.installManifestOfModel(route, model);
  } catch (error) {
    // 反查失败无法证明来源：与工具层一致按未登记拒绝，不能当作自建豁免。
    ctx.logger.warn(`资产闸门：模型安装记录反查失败（${route}/${model}）：${error instanceof Error ? error.message : String(error)}。`);
    const denial = gate.unlisted();
    return { reason: denial.message, code: denial.reason };
  }
  if (record === undefined) return undefined;
  if (record.kind === 'custom') return undefined;
  const assetId = typeof record.assetId === 'string' && record.assetId.trim() ? record.assetId.trim() : undefined;
  if (record.source === 'market' && assetId !== undefined) {
    const decision = await gate.decide({ assetType: 'model', assetId, usage: 'use' });
    return decision.allow ? undefined : { reason: decision.message, code: decision.reason, assetType: 'model', assetId };
  }
  const denial = gate.unlisted();
  return { reason: denial.message, code: denial.reason, assetType: 'model', ...(assetId ? { assetId } : {}) };
}

/**
 * 注册模型请求拦截。
 *
 * 模型不是工具，`tools/pre-execute` 结构上覆盖不到；`agent/request` 是请求配置
 * 确定的瀑布口，`next()` 给出最终 provider/model，抛错会让本轮请求发不出去。
 * 只在模型子闸门开启时注册，关闭时本监听器根本不存在。
 */
function registerModelRequestGuard(ctx: Context, gate: GateLike): () => void {
  return ctx.on('agent/request', async (payload, next) => {
    const config = await next();
    if (payload.signal.aborted) return config;
    let denial: GateDenial | undefined;
    try {
      denial = await judgeModel(ctx, gate, config);
    } catch (error) {
      // 判定异常同样拒绝，并给出明确的「判定异常」原因码，而不是裸抛内部错误。
      ctx.logger.warn(`资产闸门：模型判定失败：${error instanceof Error ? error.message : String(error)}。`);
      denial = evaluationDenial();
    }
    if (denial !== undefined) {
      gate.auditDenied?.({
        layer: 'call_model',
        reasonCode: denial.code,
        ...(denial.assetType ? { assetType: denial.assetType } : {}),
        ...(denial.assetId ? { assetId: denial.assetId } : {}),
      });
      throw new AssetGateModelDenied(denial.code, denial.reason);
    }
    return config;
  });
}

interface CatalogEntry { readonly name: string; readonly description: string }

interface MessageSourceLike {
  readonly kind?: unknown;
  readonly name?: unknown;
  readonly entries?: unknown;
}

type MessageLike = {
  readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[];
  readonly source?: MessageSourceLike;
};

const sourceOf = (message: unknown): MessageSourceLike | undefined => {
  const source = (message as MessageLike | null)?.source;
  return source !== null && typeof source === 'object' ? source : undefined;
};

/** 只认官方写入的 `{ name, description }` 对；形状不符的记录按「不是技能消息」处理。 */
function readEntries(source: MessageSourceLike | undefined): CatalogEntry[] | undefined {
  if (!Array.isArray(source?.entries)) return undefined;
  const entries: CatalogEntry[] = [];
  for (const raw of source.entries) {
    if (raw === null || typeof raw !== 'object') return undefined;
    const { name, description } = raw as { name?: unknown; description?: unknown };
    if (typeof name !== 'string' || name === '' || typeof description !== 'string') return undefined;
    entries.push({ name, description });
  }
  return entries;
}

const sameEntries = (left: readonly CatalogEntry[], right: readonly CatalogEntry[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry.name === right[index].name && entry.description === right[index].description);

interface SessionEventLike { readonly type: string; readonly seq: number; readonly data: unknown }
interface SessionLike {
  readonly seq: number;
  readonly surface: { readonly nodes: readonly number[] };
  eventAt(index: number): SessionEventLike | undefined;
}

/**
 * 镜像官方 `catalogHistory` 的可见性检查：最近一条**在上下文窗口内**的技能目录。
 *
 * 官方因为「可见目录摘要 ≠ 全量摘要」会每步重发目录消息；我们过滤后摘要必然变化，
 * 若不抑制就会每步多出一条目录。这里判断「模型上下文里已经有一份内容完全相同的过滤结果」，
 * 相同则丢弃本次重发；滑出窗口或内容变化时保留新消息，保证目录不会丢。
 */
function visibleCatalog(agent: Agent): CatalogEntry[] | undefined {
  const session = (agent as unknown as { session?: SessionLike }).session;
  if (!session) return undefined;
  try {
    const visible = new Set<number>(session.surface.nodes);
    for (let index = session.seq - 1; index >= 0; index -= 1) {
      const event = session.eventAt(index);
      if (event === undefined) return undefined;
      if (event.type !== 'user/message') continue;
      const source = (event.data as { source?: MessageSourceLike } | undefined)?.source;
      if (source?.kind !== 'skill-catalog') continue;
      const entries = readEntries(source);
      if (entries === undefined) continue;
      return visible.has(event.seq) ? entries : undefined;
    }
  } catch {
    // 读不到会话状态就按「不可见」处理：宁可多推一条目录，也不能让模型失去清单。
    return undefined;
  }
  return undefined;
}

/** 过滤目录消息：同时裁剪 `source.entries` 与正文行，保证元数据与模型看到的内容一致。 */
function filterCatalog(message: unknown, entries: readonly CatalogEntry[], kept: readonly CatalogEntry[]): unknown {
  const keptNames = new Set(kept.map((entry) => entry.name));
  const deniedNames = new Set(entries.filter((entry) => !keptNames.has(entry.name)).map((entry) => entry.name));
  const content = ((message as MessageLike).content ?? []).map((block) => {
    if (block?.type !== 'text' || typeof block.text !== 'string') return block;
    const text = block.text.split('\n').filter((line) => {
      const match = /^- `([^`]+)`:/.exec(line);
      return match === null || !deniedNames.has(match[1]);
    }).join('\n');
    return { ...block, text };
  });
  return { ...(message as Record<string, unknown>), content, source: { ...sourceOf(message), entries: kept } };
}

/**
 * 过滤一步里的技能消息：未授权技能的斜杠注入直接移除，目录消息按授权裁剪。
 * 返回值 `undefined` 表示没有改动，调用方原样返回官方决策。
 */
async function filterSkillMessages(ctx: Context, gate: GateLike, agent: Agent, messages: readonly unknown[]): Promise<unknown[] | undefined> {
  const skills = ctx.reflect.get('workdshSkills') as SkillDirectoryLike | undefined;
  const cache = new Map<string, GateDenial | null>();
  const verdict = async (name: string): Promise<GateDenial | null> => {
    const hit = cache.get(name);
    if (hit !== undefined) return hit;
    let denial: GateDenial | null = null;
    let manifest: InstallManifestLike | undefined;
    try {
      manifest = await skills?.installManifest?.(name);
      denial = (await judge(gate, 'skill', manifest)) ?? null;
    } catch (error) {
      // 清单读取失败按未登记拒绝：闸门整体是 fail-closed 姿态。
      ctx.logger.warn(`资产闸门：技能清单读取失败（${name}）：${error instanceof Error ? error.message : String(error)}。`);
      const fallback = gate.unlisted();
      denial = { reason: fallback.message, code: fallback.reason, assetType: 'skill' };
    }
    // 授权通过后，注入阶段同样要比对内容摘要；开关关闭时这一步零 IO。
    if (denial === null) denial = (await integrityDenial(ctx, gate, skills, name, manifest)) ?? null;
    cache.set(name, denial);
    if (denial !== null) {
      // 注入阶段用独立层级，和工具管线「调用被拒」区分开。
      gate.auditDenied?.({
        layer: 'call_skill_inject',
        reasonCode: denial.code,
        assetType: 'skill',
        ...(denial.assetId ? { assetId: denial.assetId } : {}),
        toolName: name,
      });
    }
    return denial;
  };
  const allowed = async (name: string): Promise<boolean> => (await verdict(name)) === null;

  const next: unknown[] = [];
  let changed = false;
  for (const message of messages) {
    const source = sourceOf(message);
    if (source?.kind === 'skill-invocation' && typeof source.name === 'string') {
      if (await allowed(source.name)) next.push(message);
      else changed = true;
      continue;
    }
    if (source?.kind === 'skill-catalog') {
      const entries = readEntries(source);
      if (entries === undefined) { next.push(message); continue; }
      const kept: CatalogEntry[] = [];
      for (const entry of entries) if (await allowed(entry.name)) kept.push(entry);
      if (kept.length === entries.length) { next.push(message); continue; }
      changed = true;
      const published = visibleCatalog(agent);
      if (published !== undefined && sameEntries(published, kept)) continue;
      next.push(filterCatalog(message, entries, kept));
      continue;
    }
    next.push(message);
  }
  return changed ? next : undefined;
}

/**
 * 过滤流程自身失败时的兜底：移除技能目录与斜杠注入，其余消息原样保留。
 *
 * 与「拒绝整步」不同，普通对话仍能继续；但技能正文（斜杠注入携带的指令文本）
 * 绝不能因为过滤失败而进入上下文。
 */
function stripSkillMessages(messages: readonly unknown[]): unknown[] {
  return messages.filter((message) => {
    const kind = sourceOf(message)?.kind;
    return kind !== 'skill-catalog' && kind !== 'skill-invocation';
  });
}

/**
 * 注册技能消息过滤。
 *
 * 斜杠调用是 `agent/pre-step` 的消息注入，不经过工具管线，pre-execute 拦不到；
 * 这一步是它进模型前的唯一关口。`prepend` 保证本监听比官方追加者更外层。
 */
function registerSkillMessageFilter(ctx: Context, gate: GateLike): () => void {
  return ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    if (!gate.enabled('skill')) return decision;
    try {
      payload.signal.throwIfAborted();
      const messages = await filterSkillMessages(ctx, gate, payload.agent, decision.messages);
      return messages === undefined ? decision : { ...decision, messages: messages as typeof decision.messages };
    } catch (error) {
      // 过滤失败不能放行未过滤的技能消息：移除技能目录与斜杠注入，其余消息照常进入。
      ctx.logger.warn(`资产闸门：技能消息过滤失败，本步已移除技能目录与斜杠注入：${error instanceof Error ? error.message : String(error)}。`);
      return { ...decision, messages: stripSkillMessages(decision.messages) as typeof decision.messages };
    }
  }, { prepend: true });
}

/**
 * 安装调用期执行层，返回注销函数。
 *
 * 注册只由生效闸门驱动：关闭时不注册任何监听器；后台开闸后经策略事件即时生效，无需重启。
 */
export function installAssetGateEnforcement(ctx: Context): () => void {
  let tools: (() => void) | undefined;
  let steps: (() => void) | undefined;
  let models: (() => void) | undefined;

  const sync = (): void => {
    const gate = ctx.reflect.get('workdshAssetGate') as GateLike | undefined;
    const wantTools = gate !== undefined && (gate.enabled('mcp') || gate.enabled('skill'));
    const wantSteps = gate !== undefined && gate.enabled('skill');
    const wantModels = gate !== undefined && gate.enabled('model');
    if (wantTools && tools === undefined) tools = registerToolInterception(ctx, gate);
    else if (!wantTools && tools !== undefined) { tools(); tools = undefined; }
    if (wantSteps && steps === undefined) steps = registerSkillMessageFilter(ctx, gate);
    else if (!wantSteps && steps !== undefined) { steps(); steps = undefined; }
    if (wantModels && models === undefined) models = registerModelRequestGuard(ctx, gate);
    else if (!wantModels && models !== undefined) { models(); models = undefined; }
  };

  const off = ctx.on('workdsh/asset-gate/policy', () => { sync(); });
  sync();
  return () => {
    off();
    tools?.(); tools = undefined;
    steps?.(); steps = undefined;
    models?.(); models = undefined;
  };
}

/** 仅供测试：清理跨用例共享的 guard 结果表。 */
export function resetEnforcementState(): void {
  denials.clear();
}
