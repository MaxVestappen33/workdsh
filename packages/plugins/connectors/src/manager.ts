import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import * as McpClient from '@deepseek-ai/dsh-mcp-client';
import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
import type { ConnectorAssetLookup, ConnectorConfigView, ConnectorInput, ConnectorManagementService, ConnectorState, ConnectorSummary, ConnectorTool } from './shared.js';
import { requestHeadersOf } from './shared.js';
import { installEmptyCursorCompat } from './mcp-compat.js';
import { connectorDefinitionSchema, connectorSelectionsDomainSpec, connectorsDomainSpec, type ConnectorDefinition, type ConnectorSelection } from './storage.js';

declare module '@deepseek-ai/cordis' { interface Context { workdshConnectors: ConnectorManagementService; } }

const serverPath = fileURLToPath(new URL('./example-server.mjs', import.meta.url));
/**
 * 随包内置的示例连接器：它由运行中的包提供，不是用户自建，也没有后台编号。
 * 闸门据此区分内置与自建，避免把内置连接器当成「未登记」拒绝。
 */
export function isBundledConnector(definition: Pick<ConnectorDefinition, 'id' | 'serverName' | 'transport' | 'command' | 'args' | 'authorizationCredentialRef'>): boolean {
  return definition.id === 'workdsh-example' && definition.serverName === 'workdsh-example'
    && definition.transport === 'stdio' && !definition.authorizationCredentialRef
    && definition.args?.length === 1 && /(?:^|[\\/])example-server\.mjs$/.test(definition.args[0]!)
    && /(?:^|[\\/])node(?:\.exe)?$/.test(definition.command ?? '');
}
/** The bundled example belongs to the running package, not its installation path. */
export function connectorProcess(definition: Pick<ConnectorDefinition, 'id' | 'serverName' | 'transport' | 'command' | 'args' | 'authorizationCredentialRef'>) {
  return isBundledConnector(definition) ? { command: process.execPath, args: [serverPath] }
    : { command: definition.command!, args: [...(definition.args ?? [])] };
}
type ChildFiber = { dispose(): Promise<void> };
type Runtime = { child?: ChildFiber; state: ConnectorState; diagnostic?: string };

/** 闸门服务的最小结构面：插件未接入时全部退回「无闸门」行为。 */
interface AssetGateProbe {
  enabled(assetType: string): boolean;
  revoked(assetType: string, assetId: string): boolean;
  clearRevoked(assetType: string, assetId: string): void;
  revocationReason(): { readonly reason: string; readonly message: string };
  decide(request: { readonly assetType: string; readonly assetId: string; readonly usage: string }):
    Promise<{ readonly allow: boolean; readonly message: string }>;
  /** 工具级白名单；旧版闸门没有该方法时按未收窄处理。 */
  mcpTools?(assetId: string): { readonly restricted: boolean; readonly tools: readonly string[] };
}

/**
 * 与官方 `dsh-mcp-client` 完全一致的公共工具名推导。
 *
 * 官方明确「公共名不用于还原原始名」，因此这里只做正向推导（原始名 → 公共名）：
 * 用它构造白名单的允许集合，再与实际注册的工具名求交。推导一旦与官方规则分歧，
 * 表现是「已授权的工具被误拒」而不是「未授权的工具被误放」，方向安全。
 *
 * @param serverName 连接器本地标识
 * @param rawName    MCP 服务自己声明的工具名
 */
export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_');
  if (normalized === joined && normalized.length <= 64) return normalized;
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, 12);
  return `${normalized.slice(0, 64 - 12 - 1)}_${hash}`;
}

/**
 * 连接器没有资产目录，只能校验「定义摘要」：对来源定义的可执行字段求稳定 sha256。
 * 用 JSON 数组而非对象序列化，避免字段顺序变化引起误报。
 */
function definitionDigest(definition: Pick<ConnectorDefinition, 'serverName' | 'transport' | 'command' | 'args' | 'url' | 'title'>): string {
  return createHash('sha256').update(JSON.stringify([
    definition.serverName,
    definition.transport,
    definition.command ?? null,
    definition.args ?? [],
    definition.url ?? null,
    definition.title,
  ])).digest('hex');
}
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
/** 把官方工具 schema 投影为界面展示用的工具信息（含入参的必填标记与说明）。 */
const toolDetail = (schema: { name: string; description?: string; parameters?: Record<string, unknown> }): ConnectorTool => {
  const parameters = Object.entries(schema.parameters ?? {}).flatMap(([name, raw]) => {
    const value = record(raw); if (!value) return [];
    return [{ name, required: value.required === true, ...(typeof value.description === 'string' ? { description: value.description } : {}) }];
  });
  return { name: schema.name, ...(schema.description ? { description: schema.description } : {}), parameters };
};
const idPart = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const refFor = (value: string) => credentialRef(value) as unknown as Parameters<Context['credentials']['resolve']>[0];
/**
 * 凭据里存的请求头：新格式是 JSON 对象（名称 → 值，市场可配置多个自定义头）；
 * 存量安装存的是裸令牌，仍按 `Authorization` 使用，不需要迁移。
 */
const credentialHeaders = (value: string): Record<string, string> => {
  if (value.trim().startsWith('{')) {
    try {
      const parsed = record(JSON.parse(value));
      const entries = parsed
        ? Object.entries(parsed).flatMap(([key, item]) => (typeof item === 'string' && item.trim() ? [[key, item] as const] : []))
        : [];
      if (entries.length) return Object.fromEntries(entries);
    } catch { /* 不是 JSON：按存量裸令牌处理 */ }
  }
  return { Authorization: value };
};
/**
 * 本次要写入凭据的请求头：市场条目按 `requestHeaders` 原样带入，单令牌输入等价于 Authorization。
 */
export const inputHeaders = (input: Pick<ConnectorInput, 'requestHeaders' | 'authorizationToken'>): Record<string, string> | undefined => {
  const headers: Record<string, string> = {};
  for (const header of requestHeadersOf(input.requestHeaders)) headers[header.key] = header.value;
  const token = input.authorizationToken?.trim();
  if (token && !Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) headers.Authorization = token;
  return Object.keys(headers).length ? headers : undefined;
};
/** 分类文案去空、去重并限定条目数，与连接器定义的存储上限保持一致。 */
const categoriesOf = (value: readonly string[] | undefined): readonly string[] =>
  [...new Set((value ?? []).flatMap(item => (item.trim() ? [item.trim()] : [])))].slice(0, 8);
/**
 * 连接失败的诊断文案。官方 MCP 客户端把真实原因放在包装错误的 `cause` 里
 * （外层只有「initial connection or tool synchronization failed」），只取 message 会让界面
 * 失去全部信息；这里沿 cause 链把每一层原文都带出来，网络不通、404、非 MCP 协议才区分得开。
 */
const failureText = (cause: unknown): string => {
  const parts: string[] = [];
  let current: unknown = cause;
  while (current instanceof Error && parts.length < 4) {
    const message = current.message.trim();
    if (message && !parts.includes(message)) parts.push(message);
    current = current.cause;
  }
  return parts.length ? parts.join('：') : 'MCP 服务启动失败。';
};

export interface ConnectorManagerOptions {
  /** 出厂不预置 MCP：随包示例只在显式开启时写入本地列表，供探针与本地调试当夹具使用。 */
  seedExample?: boolean;
}

/** Persist connector instances here; delegate protocol, transport, discovery and reconnect to official MCP clients. */
export class ConnectorManager extends Service implements ConnectorManagementService {
  static inject = ['storageDomain', 'tools', 'mcpResources', 'agents', 'credentials', 'workdshSessionAccess'];
  private definitions?: KvTable<string, ConnectorDefinition>;
  private selections?: KvTable<string, ConnectorSelection>;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly restrictions = new WeakMap<Agent, () => void>();
  private serial: Promise<void> = Promise.resolve();

  constructor(ctx: Context, private readonly options: ConnectorManagerOptions = {}) { super(ctx, 'workdshConnectors'); }

  async [Service.init](): Promise<void> {
    // 必须早于任何 MCP 建连：服务端在没有下一页时下发空 nextCursor 会让官方客户端多翻一页、
    // 取到重复工具并判重失败，这里装一层最小兼容（详见 mcp-compat.ts）。
    this.ctx.effect(() => installEmptyCursorCompat(detail => {
      this.ctx.logger.warn(`连接器：${detail.url} 的 ${detail.method} 返回了空 nextCursor，已在本机兼容处理。`);
    }), 'workdshConnectors.emptyCursorCompat');
    const domain = await this.ctx.storageDomain.open(connectorsDomainSpec);
    this.ctx.effect(() => () => domain.close(), 'workdshConnectors.domainClose');
    this.definitions = domain.table('definitions');
    const selectionDomain = await this.ctx.storageDomain.open(connectorSelectionsDomainSpec);
    this.ctx.effect(() => () => selectionDomain.close(), 'workdshConnectors.selectionDomainClose');
    this.selections = selectionDomain.table('selections');
    // 出厂不预置任何 MCP 定义：本地列表只由用户添加或市场安装产生，随包示例必须显式开启种子。
    if (this.options.seedExample === true && !domain.global.get().seededExample) {
      const now = new Date().toISOString();
      // 随包示例属于内置资产：没有后台编号也要留下清单，否则闸门开启后会被当成自建拒绝。
      await this.definitions.put('workdsh-example', {
        id: 'workdsh-example', title: 'WorkDSH MCP 示例', description: '可查询业务目录，并通过 MCP 资源与 URI 模板读取示例资料。',
        serverName: 'workdsh-example', transport: 'stdio', command: process.execPath, args: [serverPath], enabled: true,
        installManifest: { assetType: 'mcp', source: 'builtin', installedAt: now },
        createdAt: now, updatedAt: now,
      });
      await domain.global.set({ seededExample: true });
    }
    for (const [, definition] of this.table().entries()) {
      this.runtimes.set(definition.id, { state: definition.enabled ? 'discovering' : 'disabled' });
      if (definition.enabled) void this.start(definition).catch(() => undefined);
    }
    this.ctx.on('agent/created', ({ agent }) => { this.applyRestriction(agent); return undefined; });
    for (const agent of this.ctx.agents.list()) this.applyRestriction(agent);
    this.ctx.effect(() => () => this.dispose(), 'workdshConnectors.runtimeClose');
  }

  async list(signal?: AbortSignal): Promise<readonly ConnectorSummary[]> {
    signal?.throwIfAborted(); const rows: ConnectorSummary[] = [];
    for (const [, definition] of this.table().entries()) rows.push(await this.summary(definition, signal));
    return rows.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }

  async config(id: string): Promise<ConnectorConfigView> {
    const row = this.definition(id);
    const credential = row.authorizationCredentialRef
      ? await this.ctx.credentials.describe(refFor(row.authorizationCredentialRef))
      : { configured: false, writable: true };
    return { id, title: row.title, description: row.description, serverName: row.serverName, transport: row.transport,
      ...(row.command ? { command: row.command } : {}), ...(row.args ? { args: row.args } : {}), ...(row.url ? { url: row.url } : {}),
      authorizationConfigured: credential.configured, authorizationWritable: credential.writable, editable: true };
  }

  async create(input: ConnectorInput): Promise<ConnectorSummary> {
    return this.enqueue(async () => {
      const normalized = this.normalize(input); this.assertUniqueServer(normalized.serverName);
      const base = idPart(normalized.serverName) || 'mcp'; let id = base;
      while (this.table().get(id)) id = `${base}-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const headers = inputHeaders(input);
      const authorizationCredentialRef = headers ? this.credentialName(normalized.serverName) : undefined;
      if (headers && authorizationCredentialRef) await this.ctx.credentials.set(refFor(authorizationCredentialRef), JSON.stringify(headers));
      const definition: ConnectorDefinition = {
        id, ...normalized,
        // 连接器没有资产目录：清单写进记录值，市场装下来的把后台编号显式记在 assetId。
        installManifest: {
          assetType: 'mcp',
          ...(normalized.originId ? { assetId: normalized.originId } : {}),
          source: normalized.originId ? 'market' : 'local',
          installedAt: now,
          digest: definitionDigest(normalized),
        },
        ...(authorizationCredentialRef ? { authorizationCredentialRef } : {}), enabled: true, createdAt: now, updatedAt: now,
      };
      await this.table().put(id, definition); this.runtimes.set(id, { state: 'discovering' });
      await this.start(definition).catch(() => undefined);
      this.reapplyRestrictions();
      return this.summary(definition);
    });
  }

  async update(id: string, input: ConnectorInput): Promise<ConnectorSummary> {
    return this.enqueue(async () => {
      const current = this.definition(id); const normalized = this.normalize(input); this.assertUniqueServer(normalized.serverName, id);
      await this.stop(id, current.enabled);
      const headers = inputHeaders(input);
      const authorizationCredentialRef = current.authorizationCredentialRef ?? (headers ? this.credentialName(normalized.serverName) : undefined);
      if (authorizationCredentialRef && headers) await this.ctx.credentials.set(refFor(authorizationCredentialRef), JSON.stringify(headers));
      const next: ConnectorDefinition = { ...current, ...normalized, command: normalized.command, args: normalized.args, url: normalized.url,
        authorizationCredentialRef, updatedAt: new Date().toISOString(),
        // 定义变更后同步刷新摘要，否则下一次启用会把正常修改误判为「被篡改」。
        ...(current.installManifest ? { installManifest: { ...current.installManifest, digest: definitionDigest({ ...current, ...normalized }) } } : {}) };
      await this.table().put(id, next); this.runtimes.set(id, { state: next.enabled ? 'discovering' : 'disabled' });
      if (next.enabled) await this.start(next).catch(() => undefined);
      this.reapplyRestrictions();
      return this.summary(next);
    });
  }

  async remove(id: string): Promise<void> {
    await this.enqueue(async () => {
      const current = this.definition(id); await this.stop(id, false); await this.table().delete(id); this.runtimes.delete(id);
      this.clearGateMark('mcp', current.installManifest?.assetId);
      await this.removeFromSelections(id); this.reapplyRestrictions();
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<ConnectorSummary> {
    return this.enqueue(async () => {
      const current = this.definition(id); if (enabled === current.enabled) {
        // 用户手动启用即视为覆盖闸门的自动禁用；同值时也要清掉历史撤权标记。
        if (enabled) this.clearGateMark('mcp', current.installManifest?.assetId);
        return this.summary(current);
      }
      if (!enabled) { await this.stop(id, false); await this.removeFromSelections(id); }
      const next = { ...current, enabled, updatedAt: new Date().toISOString() };
      await this.table().put(id, next); this.runtimes.set(id, { state: enabled ? 'discovering' : 'disabled' });
      if (enabled) {
        this.clearGateMark('mcp', next.installManifest?.assetId);
        await this.start(next).catch(() => undefined);
      }
      this.reapplyRestrictions();
      return this.summary(next);
    });
  }

  /** 撤权协调：已安装且来源为市场、带后台编号的连接器。只读安装清单，不猜来源。 */
  marketAssets(): readonly { readonly localId: string; readonly assetId: string }[] {
    const rows: { localId: string; assetId: string }[] = [];
    for (const [, definition] of this.table().entries()) {
      const manifest = definition.installManifest;
      if (manifest?.source === 'market' && manifest.assetId) rows.push({ localId: definition.id, assetId: manifest.assetId });
    }
    return rows;
  }

  /**
   * 账本变化后重算运行态：被撤销的连接器停进程并移出会话选择，恢复的按用户设置重新启动。
   * 只在目标状态与当前运行态不同时动作，避免每次快照同步都重启连接。
   */
  async applyGateState(): Promise<void> {
    return this.enqueue(async () => {
      for (const [, definition] of this.table().entries()) {
        const gated = this.gated(definition);
        const desired = definition.enabled && !gated;
        const runtime = this.runtime(definition.id);
        const running = runtime.state === 'ready' || runtime.state === 'discovering' || runtime.state === 'offline';
        if (!desired && running) {
          await this.stop(definition.id, false);
          await this.removeFromSelections(definition.id);
        } else if (desired && runtime.state === 'disabled') {
          runtime.state = 'discovering';
          await this.start(definition).catch(() => undefined);
        }
      }
      // 工具白名单变化不改变运行态，必须在每次对账后无条件重算可见工具，
      // 否则会出现「执行层已拒绝、模型仍看得见」的错位。
      this.reapplyRestrictions();
    });
  }

  /**
   * 启用前定义摘要校验：
   * - `ok`：有摘要且与当前定义一致；
   * - `unverifiable`：旧记录没有摘要（如实告知，不假装校验过）；
   * - `modified`：摘要不一致，按「被修改」拒绝。
   */
  verifyDefinitionIntegrity(id: string): 'ok' | 'unverifiable' | 'modified' {
    const definition = this.definition(id);
    const expected = definition.installManifest?.digest;
    if (!expected) return 'unverifiable';
    return definitionDigest(definition) === expected ? 'ok' : 'modified';
  }

  /**
   * 一次性回填：为没有安装清单的连接器补写清单（幂等、失败不阻断启动）。
   * 来源按既有记录推定：`originId` → market（后台编号写进 assetId）；随包内置示例 → builtin；其余 → local。
   */
  async backfillInstallManifests(): Promise<{ scanned: number; written: number; failed: number }> {
    let scanned = 0; let written = 0; let failed = 0;
    for (const [id, definition] of this.table().entries()) {
      scanned += 1;
      if (definition.installManifest) continue;
      try {
        const manifest = definition.originId
          ? { assetType: 'mcp' as const, assetId: definition.originId, source: 'market' as const, installedAt: definition.createdAt }
          : { assetType: 'mcp' as const, source: isBundledConnector(definition) ? 'builtin' as const : 'local' as const, installedAt: definition.createdAt };
        await this.table().put(id, { ...definition, installManifest: manifest });
        written += 1;
      } catch (error) {
        failed += 1;
        this.ctx.logger.warn(`连接器：回填安装清单失败（${definition.title}）：${error instanceof Error ? error.message : String(error)}。`);
      }
    }
    return { scanned, written, failed };
  }

  /**
   * 按 MCP 工具名反查连接器记录的安装清单。
   *
   * 工具名由本模块生成，形如 `mcp__<serverName>__<tool>`；这里只做内存表精确匹配，
   * 不建连、不探活、不解析凭据。存在多个前缀命中的记录时取 serverName 最长的一个，
   * 避免 `a` 与 `a__b` 这类命名互相遮蔽。
   */
  connectorAssetForTool(toolName: string): ConnectorAssetLookup {
    try {
      let matched: ConnectorDefinition | undefined;
      for (const [, definition] of this.table().entries()) {
        if (!toolName.startsWith(`mcp__${definition.serverName}__`)) continue;
        if (!matched || definition.serverName.length > matched.serverName.length) matched = definition;
      }
      if (!matched) return { found: false };
      const tool = this.toolScope(matched, toolName);
      return {
        found: true,
        bundled: isBundledConnector(matched),
        ...(matched.installManifest ? { manifest: matched.installManifest } : {}),
        ...(tool ? { tool } : {}),
      };
    } catch {
      // 存储域尚未打开（初始化中）：当作没有该记录，放行后由工具自身报未知工具。
      return { found: false };
    }
  }

  /** 未显式选择过的会话默认带上全部可用连接器；显式保存过就按保存值（含显式清空的空数组）。 */
  async selection(sessionId: string): Promise<readonly string[]> {
    await this.authorizeSession(sessionId);
    return [...this.effectiveSelection(sessionId)];
  }

  async setSelection(sessionId: string, connectorIds: readonly string[]): Promise<readonly string[]> {
    await this.authorizeSession(sessionId);
    const unique = [...new Set(connectorIds)];
    // 默认全选会带上当时可用的连接器，之后它可能掉线或被删除；这里只保存当前真正可用的，
    // 避免一个不可用的历史选择阻塞整次变更（用户也就无法再调整其它连接器）。
    const usable = unique.filter(id => {
      const definition = this.table().get(id);
      return Boolean(definition?.enabled && this.runtime(id).state === 'ready');
    });
    if (usable.length !== unique.length) {
      this.ctx.logger.warn(`连接器：本次选择忽略了 ${unique.length - usable.length} 个当前不可用的连接器（${unique.filter(id => !usable.includes(id)).join('、')}）。`);
    }
    await this.authorizeSession(sessionId);
    await this.selectionTable().put(sessionId, { sessionId, connectorIds: usable, updatedAt: new Date().toISOString() });
    const agent = this.ctx.agents.get(sessionId as Agent['id']);
    if (agent) this.applyRestriction(agent);
    return usable;
  }

  async dispose(): Promise<void> { for (const [id] of this.runtimes) await this.stop(id, false); }

  private async start(definition: ConnectorDefinition): Promise<void> {
    const runtime = this.runtime(definition.id); if (runtime.child) return;
    runtime.state = 'discovering'; runtime.diagnostic = undefined;
    const authorization = definition.authorizationCredentialRef
      ? await this.ctx.credentials.resolve(refFor(definition.authorizationCredentialRef))
      : undefined;
    if (definition.authorizationCredentialRef && !authorization) {
      runtime.state = 'offline';
      runtime.diagnostic = '连接授权已失效，请重新授权。';
      throw new Error('connector/authorization-missing');
    }
    const headers: Record<string, string> = authorization ? credentialHeaders(authorization.value) : {};
    const transportConfig = definition.transport === 'stdio'
      ? { serverName: definition.serverName, transport: 'stdio' as const, ...connectorProcess(definition), env: {} }
      : { serverName: definition.serverName, transport: 'streamable-http' as const, url: definition.url!, headers };
    const fiber = this.ctx.plugin(McpClient, { ...transportConfig, failOnStartupError: true, toolCallTimeoutMs: 10_000, maxInstructionBytes: 8_192,
      reconnect: { enabled: true, initialDelayMs: 250, maxDelayMs: 5_000, maxAttempts: 4 } }) as ChildFiber & PromiseLike<unknown>;
    try { await fiber; runtime.child = fiber; runtime.state = 'ready'; }
    catch (cause) { await fiber.dispose().catch(() => undefined); runtime.state = 'offline'; runtime.diagnostic = failureText(cause); throw cause; }
    // 工具集合在 start 期间才注册完成：这里重算限制，让未显式选择过的会话立刻带上新可用的连接器。
    finally { this.reapplyRestrictions(); }
  }

  private async stop(id: string, remainsEnabled: boolean): Promise<void> {
    const runtime = this.runtime(id); const child = runtime.child; runtime.child = undefined;
    if (child) await child.dispose(); runtime.state = remainsEnabled ? 'offline' : 'disabled';
  }

  private async summary(definition: ConnectorDefinition, signal?: AbortSignal): Promise<ConnectorSummary> {
    const health = await this.health(definition, signal);
    const gate = this.gateProbe();
    let authState: 'unauthorized' | 'revoked' | undefined;
    let authReason: string | undefined;
    if (gate?.enabled('mcp') && definition.installManifest?.source === 'market' && definition.installManifest.assetId) {
      const assetId = definition.installManifest.assetId;
      if (gate.revoked('mcp', assetId)) {
        authState = 'revoked'; authReason = gate.revocationReason().message;
      } else {
        const decision = await gate.decide({ assetType: 'mcp', assetId, usage: 'use' });
        if (!decision.allow) { authState = 'unauthorized'; authReason = decision.message; }
      }
    }
    // 被撤权的连接器对外表现为停用（运行时已在 applyGateState 中停掉），
    // 但不改写记录里的用户启用位，恢复授权后可自动还原。
    const gated = authState === 'revoked';
    // 工具级收窄：只影响可用工具数量，不改变连接器的授权状态与启停。
    const whitelist = this.toolWhitelist(definition);
    const deniedTools = whitelist === undefined ? [] : health.toolNames.filter(name => !whitelist.publics.has(name));
    const toolAuth = whitelist === undefined ? undefined : {
      restricted: true as const,
      allowed: whitelist.raws,
      total: health.toolNames.length,
      usable: health.toolNames.length - deniedTools.length,
      denied: deniedTools,
    };
    return { id: definition.id, title: definition.title, description: definition.description, serverName: definition.serverName,
      transport: definition.transport, scope: 'shared', enabled: definition.enabled && !gated, state: gated ? 'disabled' : health.state, toolNames: health.toolNames,
      tools: health.tools, resourceCount: health.resourceCount, resourceTemplateCount: health.resourceTemplateCount, lastCheckedAt: new Date().toISOString(),
      ...(definition.originId ? { originId: definition.originId } : {}), categories: definition.categories ?? [],
      ...(definition.installManifest ? { installManifest: definition.installManifest } : {}),
      ...(definition.marketServiceId ? { marketServiceId: definition.marketServiceId } : {}),
      ...(authState ? { authState, ...(authReason ? { authReason } : {}) } : {}),
      ...(toolAuth ? { toolAuth } : {}),
      ...(health.diagnostic ? { diagnostic: health.diagnostic } : {}) };
  }

  private gateProbe(): AssetGateProbe | undefined {
    try { return this.ctx.reflect.get('workdshAssetGate') as AssetGateProbe | undefined; } catch { return undefined; }
  }

  /** 是否因授权失效被闸门自动禁用；只对 market 来源且带编号的资产生效。 */
  private gated(definition: ConnectorDefinition): boolean {
    const manifest = definition.installManifest;
    if (manifest?.source !== 'market' || !manifest.assetId) return false;
    try { return this.gateProbe()?.revoked('mcp', manifest.assetId) === true; } catch { return false; }
  }

  private clearGateMark(assetType: string, assetId: string | undefined): void {
    if (!assetId) return;
    try { this.gateProbe()?.clearRevoked(assetType, assetId); } catch { /* 闸门不可用不影响主流程 */ }
  }

  /**
   * 连接器的工具白名单（公共名集合 + 原始名）。
   *
   * 只在「闸门开启 + 市场来源 + 有后台编号 + 连接器被收窄」时返回；
   * 其余情况返回 undefined，调用方据此完全不做工具级处理（关闭态零开销）。
   */
  private toolWhitelist(definition: ConnectorDefinition):
    { readonly publics: ReadonlySet<string>; readonly raws: readonly string[] } | undefined {
    const manifest = definition.installManifest;
    if (manifest?.source !== 'market' || !manifest.assetId) return undefined;
    const gate = this.gateProbe();
    if (!gate?.enabled('mcp')) return undefined;
    const policy = gate.mcpTools?.(manifest.assetId);
    if (!policy?.restricted || policy.tools.length === 0) return undefined;
    return {
      publics: new Set(policy.tools.map(raw => publicToolName(definition.serverName, raw))),
      raws: policy.tools,
    };
  }

  /** 该连接器当前实际注册的工具名。 */
  private liveToolNames(definition: ConnectorDefinition): readonly string[] {
    const prefix = `mcp__${definition.serverName}__`;
    try { return this.ctx.tools.schemas().map(tool => tool.name).filter(name => name.startsWith(prefix)); }
    catch { return []; }
  }

  /**
   * 一次工具调用对应的原始工具名。
   *
   * - 公共名命中白名单 → 直接给出对应的原始名；
   * - 白名单推导集合与当前注册工具完全不相交 → `untrusted`（官方命名规则可能变化，宁误拒不误放）；
   * - 其余情况：该工具不在白名单内，后缀即无损原始名，交给闸门给出「未授权工具」。
   */
  private toolScope(definition: ConnectorDefinition, toolName: string): { raw?: string; untrusted?: boolean } | undefined {
    const whitelist = this.toolWhitelist(definition);
    if (!whitelist) return undefined;
    for (const raw of whitelist.raws) {
      if (publicToolName(definition.serverName, raw) === toolName) return { raw };
    }
    const live = this.liveToolNames(definition);
    if (live.length > 0 && !live.some(name => whitelist.publics.has(name))) return { untrusted: true };
    return { raw: toolName.slice(`mcp__${definition.serverName}__`.length) };
  }

  private async health(definition: ConnectorDefinition, signal?: AbortSignal): Promise<{ state: ConnectorState; toolNames: string[]; tools: ConnectorTool[]; resourceCount: number; resourceTemplateCount: number; diagnostic?: string }> {
    const runtime = this.runtime(definition.id);
    if (!definition.enabled) return { state: 'disabled', toolNames: [], tools: [], resourceCount: 0, resourceTemplateCount: 0 };
    const prefix = `mcp__${definition.serverName}__`;
    const schemas = this.ctx.tools.schemas().filter(tool => tool.name.startsWith(prefix));
    const toolNames = schemas.map(tool => tool.name); const tools = schemas.map(toolDetail);
    if (!runtime.child) return { state: runtime.state, toolNames, tools, resourceCount: 0, resourceTemplateCount: 0, ...(runtime.diagnostic ? { diagnostic: runtime.diagnostic } : {}) };
    if (!toolNames.length) {
      // 重连期间工具会暂时消失：同步运行态，恢复后据此重算会话工具限制。
      if (runtime.state === 'ready') { runtime.state = 'discovering'; this.reapplyRestrictions(); }
      return { state: 'discovering', toolNames, tools, resourceCount: 0, resourceTemplateCount: 0 };
    }
    try {
      const agent = this.ctx.agents.list().find(candidate => this.usesConnector(String(candidate.id), definition));
      if (!agent) {
        runtime.diagnostic = '工具已连接并可用；资源与 URI 模板需要在会话中探测，当前没有会话选择该 MCP，暂未统计。';
        return { state: 'ready', toolNames, tools, resourceCount: 0, resourceTemplateCount: 0, diagnostic: runtime.diagnostic };
      }
      const call = async (name: string, args: JsonRecord) => {
        const output = await this.ctx.tools.execute({ name, arguments: args, callId: randomUUID() as never, agent, signal: signal ?? new AbortController().signal });
        if (output.isError) throw output.error; return record(output.value) ?? {};
      };
      // Resources are optional MCP capabilities. A server with working tools must not
      // be reported offline only because it does not expose resource endpoints.
      const resourceDiagnostics: string[] = [];
      const unavailable = (kind: string) => { resourceDiagnostics.push(kind); return {}; };
      const resources: JsonRecord = this.ctx.tools.get('list_mcp_resources')
        ? await call('list_mcp_resources', { server: definition.serverName }).catch(() => unavailable('resources')) : unavailable('resources');
      const templates: JsonRecord = this.ctx.tools.get('list_mcp_resource_templates')
        ? await call('list_mcp_resource_templates', { server: definition.serverName }).catch(() => unavailable('templates')) : unavailable('templates');
      const becameReady = runtime.state !== 'ready';
      runtime.state = 'ready'; runtime.diagnostic = resourceDiagnostics.length ? '工具已连接并可用；该服务未提供资源或 URI 模板能力，暂未统计。' : undefined;
      // 恢复可用后，未显式选择过的会话要立即拿到该连接器的工具命名空间。
      if (becameReady) this.reapplyRestrictions();
      return { state: 'ready', toolNames, tools, ...(runtime.diagnostic ? { diagnostic: runtime.diagnostic } : {}), resourceCount: Array.isArray(resources.resources) ? resources.resources.length : 0,
        resourceTemplateCount: Array.isArray(templates.resourceTemplates) ? templates.resourceTemplates.length : 0 };
    } catch (cause) {
      const becameOffline = runtime.state !== 'offline';
      runtime.state = 'offline'; runtime.diagnostic = cause instanceof Error ? cause.message : 'MCP 健康检查失败。';
      if (becameOffline) this.reapplyRestrictions();
      return { state: 'offline', toolNames, tools, resourceCount: 0, resourceTemplateCount: 0, diagnostic: runtime.diagnostic };
    }
  }

  private normalize(input: ConnectorInput): Omit<ConnectorDefinition, 'id' | 'enabled' | 'createdAt' | 'updatedAt'> {
    const categories = categoriesOf(input.categories);
    const value = connectorDefinitionSchema.omit({ id: true, enabled: true, createdAt: true, updatedAt: true }).parse({
      title: input.title.trim(), description: input.description?.trim() ?? '', serverName: input.serverName.trim(), transport: input.transport,
      ...(input.transport === 'stdio' ? { command: input.command?.trim(), args: [...(input.args ?? [])] } : { url: input.url?.trim() }),
      // 仅市场安装流程会传入来源与分类；用户自建实例两者皆为空，界面按「内置」呈现。
      ...(categories.length ? { categories } : {}),
      ...(input.originId?.trim() ? { originId: input.originId.trim() } : {}),
      ...(input.marketServiceId?.trim() ? { marketServiceId: input.marketServiceId.trim() } : {}),
    });
    if (value.transport === 'stdio' && !value.command) throw new Error('connector/command-required');
    if (value.transport === 'streamable-http' && !value.url) throw new Error('connector/url-required');
    return value;
  }
  private assertUniqueServer(serverName: string, except?: string): void {
    if ([...this.table().entries()].some(([id, row]) => id !== except && row.serverName === serverName)) throw new Error('connector/server-name-conflict');
  }
  private async authorizeSession(sessionId: string): Promise<void> {
    const access = this.ctx.reflect.get('workdshSessionAccess') as { inspect(id: string): Promise<unknown> } | undefined;
    if (!access) throw new Error('connector/session-access-required');
    await access.inspect(sessionId);
  }
  private credentialName(serverName: string): string { return `WORKDSH_CONNECTOR_${serverName.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_AUTHORIZATION`; }
  private definition(id: string): ConnectorDefinition { const row = this.table().get(id); if (!row) throw new Error('connector/not-found'); return row; }
  private runtime(id: string): Runtime { let row = this.runtimes.get(id); if (!row) { row = { state: 'disabled' }; this.runtimes.set(id, row); } return row; }
  private table(): KvTable<string, ConnectorDefinition> { if (!this.definitions) throw new Error('connector/unavailable'); return this.definitions; }
  private selectionTable(): KvTable<string, ConnectorSelection> { if (!this.selections) throw new Error('connector/unavailable'); return this.selections; }
  /** 当前可用的连接器：已启用且运行状态为 ready。 */
  private availableSelection(): readonly string[] {
    return [...this.table().entries()]
      .filter(([, definition]) => definition.enabled && this.runtime(definition.id).state === 'ready')
      .map(([id]) => id);
  }
  /** 会话的有效选择：有显式记录就按记录（含空数组），从未选择过则默认全部可用连接器。 */
  private effectiveSelection(sessionId: string): readonly string[] {
    const row = this.selectionTable().get(sessionId);
    return row ? row.connectorIds : this.availableSelection();
  }
  /** 未显式选择过的会话把已启用的连接器都视为本次对话可用（资源探测需要这样的调用方）。 */
  private usesConnector(sessionId: string, definition: ConnectorDefinition): boolean {
    const row = this.selectionTable().get(sessionId);
    return row ? row.connectorIds.includes(definition.id) : definition.enabled;
  }
  /**
   * 会话可见工具 = 已选连接器的工具 −（被收窄时）白名单外的工具。
   *
   * 白名单与「全部工具」是同一套投影：未收窄的连接器不产生任何 deny 项，
   * 因此闸门关闭或未收窄时与既有行为完全一致。
   */
  private applyRestriction(agent: Agent): void {
    this.restrictions.get(agent)?.();
    this.restrictions.delete(agent);
    const selected = new Set(this.effectiveSelection(String(agent.id)));
    const schemas = this.ctx.tools.schemas().map(tool => tool.name);
    const denied: string[] = [];
    for (const [id, definition] of this.table().entries()) {
      const prefix = `mcp__${definition.serverName}__`;
      const names = schemas.filter(name => name.startsWith(prefix));
      if (!selected.has(id)) {
        denied.push(...names);
        continue;
      }
      const whitelist = this.toolWhitelist(definition);
      if (!whitelist) continue;
      // 映射不可信时整连接器的工具都隐藏，避免收窄静默失效。
      if (names.length > 0 && !names.some(name => whitelist.publics.has(name))) {
        denied.push(...names);
        continue;
      }
      denied.push(...names.filter(name => !whitelist.publics.has(name)));
    }
    if (denied.length) this.restrictions.set(agent, agent.ctx.tools.restrict({ deny: denied }));
  }
  private reapplyRestrictions(): void { for (const agent of this.ctx.agents.list()) this.applyRestriction(agent); }
  private async removeFromSelections(connectorId: string): Promise<void> {
    for (const [sessionId, selection] of this.selectionTable().entries()) {
      if (!selection.connectorIds.includes(connectorId)) continue;
      await this.selectionTable().put(sessionId, { ...selection, connectorIds: selection.connectorIds.filter(id => id !== connectorId), updatedAt: new Date().toISOString() });
    }
  }
  private enqueue<T>(run: () => Promise<T>): Promise<T> { const next = this.serial.then(run, run); this.serial = next.then(() => undefined, () => undefined); return next; }
}
