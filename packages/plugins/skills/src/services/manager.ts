import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import { isSkillName, type SkillDefinition, type SkillSummary } from '@deepseek-ai/dsh-skill';
import {
  ASSET_MANIFEST_FILE, ASSET_SIGNATURE_CACHE_FILE, assetFileManifestPath, assetFileSignatureCachePath, assetManifestDigest,
  assetSignatureCachePath, compareAssetPaths, readAssetFileManifest, readAssetManifest, snapshotAssetFiles, verifyAssetFileManifest,
  verifyAssetManifest,
  writeAssetFileManifest, writeAssetManifest, type AssetManifest, type AssetManifestSource,
} from 'workdsh-asset-manifest';
import { ASSET_SIGNATURE_FRESHNESS_MS, verifyAssetSignature, type AssetSignatureEnvelope } from 'workdsh-asset-signature';
import { parse } from 'yaml';
import type { ManagedSkillDetail, ManagedSkillResource, ManagedSkillSummary, SkillBatchRequest, SkillBatchResult, SkillCatalogIcon, SkillCatalogSummary, SkillDependency, SkillDependencyImpact, SkillDiagnostic, SkillDraft, SkillDraftWriteRequest, SkillDigestVerdict, SkillImportInspection, SkillImportRequest, SkillInstallScope, SkillMutationReceipt, SkillResourceWriteRequest, SkillValidationResult, SkillWriteRequest, TrashedSkillSummary } from '../shared.js';
import { SkillImportStaging } from './import-staging.js';
import { SkillCatalogStore } from './catalog.js';
import { readSignatureCache, SIGNATURE_REINSTALL_MESSAGE, snapshotAssetFile } from './asset-signatures.js';
import { marketInstallFile, readMarketInstalls } from './market-installs.js';
import type { SkillManagementService, SkillDependencyInspector, SkillDisplayMetadata } from '../shared.js';
import type { RetainedSkillRevision, SkillConsumerRef, SkillRevisionCheck, SkillRevisionRef, SkillRevisionStatus } from 'workdsh-contracts';

declare module '@deepseek-ai/cordis' {
  interface Context { workdshSkills: SkillManagementService; }
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const describe = (error: unknown): string => error instanceof Error ? error.message : String(error);
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const trashIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}-\d{2}-\d{2}T[0-9-]+Z$/;
const maximumDocumentBytes = 1024 * 1024;
const draftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface DisabledOrigin { readonly name: string; readonly originalEntry: string; readonly directoryBundle: boolean; }
interface TrashReceipt extends TrashedSkillSummary { readonly originalEntry: string; readonly trashedEntry: string; readonly directoryBundle: boolean; }
export type { SkillDependencyInspector } from '../shared.js';

/**
 * 闸门服务的最小结构面。技能插件不直接依赖 asset-gate 包，避免循环依赖；
 * 服务未安装（个人模式/测试）时所有调用都安全退回「无闸门」行为。
 */
interface AssetGateProbe {
  enabled(assetType: string): boolean;
  /** 主闸门与验签开关是否同时开启；旧版闸门没有该方法时按关闭处理。 */
  signatureEnabled?(): boolean;
  revoked(assetType: string, assetId: string): boolean;
  clearRevoked(assetType: string, assetId: string): void;
  revocationReason(): { readonly reason: string; readonly message: string };
  /** 判定过程抛异常时的原因码与文案：列表标记复用同一份。 */
  evaluationError(): { readonly reason: string; readonly message: string };
  decide(request: { readonly assetType: string; readonly assetId: string; readonly usage: string }):
    Promise<{ readonly allow: boolean; readonly message: string }>;
}

interface RetentionManifest {
  readonly ref: SkillRevisionRef;
  readonly contentDigest: string;
  readonly files: readonly { readonly path: string; readonly byteLength: number; readonly sha256: string }[];
  readonly retainedBy: readonly SkillConsumerRef[];
  readonly createdAt: string;
}

function addConsumer(list: readonly SkillConsumerRef[], consumer: SkillConsumerRef): SkillConsumerRef[] {
  const filtered = list.filter((entry) => !(entry.domain === consumer.domain && entry.id === consumer.id));
  return [...filtered, consumer];
}

/** Frozen-content fingerprint over SKILL.md + resources, plus per-file manifest stats. */
async function snapshotFiles(directory: string, signal?: AbortSignal): Promise<{ files: { path: string; byteLength: number; sha256: string }[]; contentDigest: string }> {
  const resources = await resourceFiles(directory);
  const paths = ['SKILL.md', ...resources].sort();
  const hash = createHash('sha256');
  const files: { path: string; byteLength: number; sha256: string }[] = [];
  for (const path of paths) {
    signal?.throwIfAborted();
    const bytes = await readFile(join(directory, path));
    files.push({ path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
    hash.update(path); hash.update('\0'); hash.update(bytes); hash.update('\0');
  }
  return { files, contentDigest: hash.digest('hex') };
}

function inside(root: string, target: string): boolean {
  const part = relative(resolve(root), resolve(target));
  return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !part.startsWith(sep));
}

/**
 * 调用期摘要缓存的失效指纹：只 stat、不读内容。
 *
 * 目录形态递归列出 `path\0size\0mtimeMs`（跳过清单自身、签名缓存与符号链接，
 * 与 snapshotAssetFiles 同口径），排序后求 sha256；单文件形态只取该文件。
 * 指纹只用于决定「是否要重算摘要」，不参与安全结论。
 */
async function digestFingerprint(target: string, directoryBundle: boolean): Promise<string> {
  const hash = createHash('sha256');
  if (!directoryBundle) {
    const info = await stat(target);
    hash.update(`${basename(target)}\0${info.size}\0${Math.round(info.mtimeMs)}\0`);
    return hash.digest('hex');
  }
  const visit = async (directory: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 8) throw new Error('asset-manifest/too-deep');
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.name !== ASSET_MANIFEST_FILE && entry.name !== ASSET_SIGNATURE_CACHE_FILE);
    const relativePath = (name: string): string => (prefix ? `${prefix}/${name}` : name);
    entries.sort((left, right) => compareAssetPaths(relativePath(left.name), relativePath(right.name)));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      const rel = relativePath(entry.name);
      if (entry.isDirectory()) { await visit(path, rel, depth + 1); continue; }
      if (!entry.isFile()) continue;
      const info = await stat(path);
      hash.update(`${rel}\0${info.size}\0${Math.round(info.mtimeMs)}\0`);
    }
  };
  await visit(target, '', 0);
  return hash.digest('hex');
}

function frontmatter(document: string): Record<string, unknown> {
  const match = document.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('skill/invalid-frontmatter');
  try {
    const value = parse(match[1]);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('skill/invalid-frontmatter');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'skill/invalid-frontmatter') throw error;
    throw new Error('skill/invalid-frontmatter');
  }
}

function frontmatterValue(document: string, key: string): string | undefined {
  try { const value = frontmatter(document)[key]; return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
  catch { return undefined; }
}

async function resourceFiles(directory: string, root = directory, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const rows = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const row of rows) {
    if (row.isSymbolicLink()) continue;
    const path = join(directory, row.name);
    if (row.isDirectory()) files.push(...await resourceFiles(path, root, depth + 1));
    else if (row.isFile() && row.name !== 'SKILL.md' && row.name !== ASSET_MANIFEST_FILE && row.name !== ASSET_SIGNATURE_CACHE_FILE) files.push(relative(root, path));
    if (files.length >= 200) break;
  }
  return files.slice(0, 200).sort();
}

async function inspectImportTree(source: string, signal?: AbortSignal): Promise<{ document: string; root: string; files: string[]; totalBytes: number; fingerprint: string }> {
  signal?.throwIfAborted();
  const sourceInfo = await lstat(source);
  if (sourceInfo.isSymbolicLink()) throw new Error('skill/import-symlink');
  const root = sourceInfo.isDirectory() ? source : dirname(source);
  const skillFile = sourceInfo.isDirectory() ? join(source, 'SKILL.md') : source;
  if (!sourceInfo.isDirectory() && basename(source) !== 'SKILL.md') throw new Error('skill/import-missing-skill-md');
  const files: string[] = []; let totalBytes = 0;
  const visit = async (directory: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    if (depth > 6) throw new Error('skill/import-too-deep');
    for (const row of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, row.name);
      if (row.isSymbolicLink()) throw new Error('skill/import-symlink');
      if (row.isDirectory()) await visit(path, depth + 1);
      else if (row.isFile()) {
        const info = await stat(path); totalBytes += info.size; files.push(relative(root, path));
        if (files.length > 400 || totalBytes > 50 * 1024 * 1024) throw new Error('skill/import-too-large');
      }
    }
  };
  if (sourceInfo.isDirectory()) await visit(root, 0);
  else { files.push('SKILL.md'); totalBytes = sourceInfo.size; }
  let document: string;
  try { document = await readFile(skillFile, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('skill/import-missing-skill-md');
    throw error;
  }
  const sortedFiles = files.sort();
  const fingerprint = createHash('sha256');
  for (const file of sortedFiles) {
    signal?.throwIfAborted();
    fingerprint.update(file); fingerprint.update('\0');
    fingerprint.update(await readFile(join(root, file))); fingerprint.update('\0');
  }
  return { document, root, files: sortedFiles, totalBytes, fingerprint: fingerprint.digest('hex') };
}

async function copyImportTree(source: string, target: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const sourceInfo = await lstat(source);
  if (sourceInfo.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const row of await readdir(source, { withFileTypes: true })) {
      if (row.isSymbolicLink()) throw new Error('skill/import-symlink');
      const from = join(source, row.name); const to = join(target, row.name);
      if (row.isDirectory()) await copyImportTree(from, to, signal);
      else if (row.isFile()) await copyFile(from, to);
    }
  } else {
    await mkdir(target, { recursive: true }); await copyFile(source, join(target, 'SKILL.md'));
  }
}

/** Explicit Host scope configuration; never derived from a browser/model request. */
export interface SkillManagerOptions {
  dshHome?: string;
  agentsHome?: string;
  catalogRoot?: string;
  /** Optional server-owned import boundary; personal imports remain unrestricted. */
  importRoot?: string;
}

/** Host authority for local skill files. Harness remains the discovery and execution owner. */
export class SkillManager extends Service implements SkillManagementService {
  readonly contractVersion = 1 as const;
  private readonly activeRoots: readonly string[];
  private readonly disabledRoot: string;
  private readonly trashRoot: string;
  private readonly stateRoot: string;
  private readonly lockRoot: string;
  private readonly originRoot: string;
  private readonly receiptRoot: string;
  private readonly draftRoot: string;
  private readonly catalogStore: SkillCatalogStore;
  private readonly importRoot?: string;
  private readonly dependencyInspectors = new Set<SkillDependencyInspector>();
  private readonly displayContributions = new Map<string, ReadonlyMap<string, SkillDisplayMetadata>>();
  /** 调用期摘要缓存：技能名 → 指纹 + 结论；只影响性能，不改变安全口径。 */
  private readonly digestCache = new Map<string, { readonly key: string; readonly verdict: SkillDigestVerdict }>();
  readonly imports: SkillImportStaging;

  constructor(ctx: Context, options: SkillManagerOptions = {}) {
    super(ctx, 'workdshSkills');
    this.importRoot = options.importRoot === undefined ? undefined : resolve(options.importRoot);
    const dshHome = resolve(options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
    const agentsHome = resolve(options.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(dshHome, 'agents'));
    this.activeRoots = [join(agentsHome, 'skills'), join(dshHome, 'skills')];
    this.disabledRoot = join(agentsHome, '.workdsh-disabled', 'skills');
    this.trashRoot = join(agentsHome, '.workdsh-trash', 'skills');
    this.stateRoot = join(agentsHome, '.workdsh-state', 'skills');
    this.lockRoot = join(this.stateRoot, 'locks');
    this.originRoot = join(this.stateRoot, 'disabled-origins');
    this.receiptRoot = join(this.stateRoot, 'trash-receipts');
    this.draftRoot = join(this.stateRoot, 'drafts');
    this.catalogStore = new SkillCatalogStore(options.catalogRoot ??
      (options.agentsHome === undefined ? process.env.WORKDSH_SKILL_CATALOG : undefined));
    this.imports = new SkillImportStaging(
      join(this.stateRoot, 'imports'),
      (source, signal) => this.inspectImport(source, signal),
      (request, signal) => this.installImport(request, signal),
    );
  }

  async list(signal?: AbortSignal): Promise<readonly ManagedSkillSummary[]> {
    signal?.throwIfAborted();
    const skills = await this.ctx.skills.list({ signal });
    const rows: ManagedSkillSummary[] = [];
    const registeredFiles = new Set<string>();
    for (const skill of skills) {
      const manageable = this.isManagedSummary(skill);
      let title: string | undefined;
      if (manageable) {
        const definition = await this.ctx.skills.get(skill.name, { signal });
        const path = definition?.path;
        if (!path) continue;
        try { if (!await this.isSafeManagedFile(path)) continue; registeredFiles.add(await realpath(path)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as Error).message === 'skill/path-symlink') continue; throw error; }
        // 官方 provider 的 content/metadata 已剥离 frontmatter，显示名需自行读取 SKILL.md 解析。
        // 本地目录元数据与内置硬编码随后仍会覆盖它。
        try { title = frontmatterValue(await readFile(path, 'utf8'), 'title'); } catch { /* 读不到时回落 name */ }
      }
      rows.push({ name: skill.name, description: skill.description, whenToUse: skill.whenToUse,
        ...(title ? { title } : {}),
        modelInvocable: skill.invocation.modelInvocable, state: manageable ? 'enabled' : 'readonly', manageable });
    }
    for (const root of this.activeRoots) {
      await mkdir(root, { recursive: true });
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const name = entry.isDirectory() ? entry.name : entry.isFile() && entry.name.endsWith('.md') ? entry.name.slice(0, -3) : undefined;
        if (!name || !skillNamePattern.test(name) || rows.some(row => row.name === name)) continue;
        let active;
        try { active = await this.activeEntry(name); }
        catch (error) { if ((error as Error).message === 'skill/path-symlink') continue; throw error; }
        if (!active) continue;
        if (registeredFiles.has(await realpath(active.file))) continue;
        const document = await readFile(active.file, 'utf8');
        const validation = this.validateDocument(document);
        const displayName = validation.valid ? validation.name ?? name : name;
        if (rows.some(row => row.name === displayName)) continue;
        // 显示名可来自技能自己的 SKILL.md frontmatter(title)；本地目录元数据与内置硬编码随后仍会覆盖它。
        const title = frontmatterValue(document, 'title');
        rows.push({
          name: displayName,
          description: validation.description ?? '技能文件需要修复',
          whenToUse: frontmatterValue(document, 'when-to-use'),
          ...(title ? { title } : {}),
          modelInvocable: validation.valid,
          state: validation.valid ? 'enabled' : 'invalid',
          manageable: true,
          ...(validation.valid ? {} : { diagnostics: validation.diagnostics }),
        });
      }
    }
    await mkdir(this.disabledRoot, { recursive: true });
    for (const entry of await readdir(this.disabledRoot, { withFileTypes: true })) {
      const name = entry.isDirectory() ? entry.name : entry.isFile() && entry.name.endsWith('.md') ? entry.name.slice(0, -3) : undefined;
      if (!name || rows.some(row => row.name === name)) continue;
      const disabled = await this.readDetail(name, signal);
      if (disabled) rows.push(disabled);
    }
    const metadata = await this.catalogStore.metadata(new Set(rows.map(row => row.name)));
    // 内置属性以技能市场为准，这里只读安装记录里的最后一次同步结果作为兜底：
    // 市场可用时界面会用市场索引覆盖它，市场不可用时才按它展示与筛选。
    const installs = await readMarketInstalls(marketInstallFile(this.stateRoot), message => this.ctx.logger.warn(message));
    const builtinNames = new Set([...installs.values()]
      .flatMap(record => (record.builtin ? [record.name.trim().toLowerCase()] : [])));
    const merged = rows.map(row => {
      const entry = metadata.get(row.name); const contribution = this.contributedDisplay(row.name);
      return {
        ...row, ...contribution, ...entry,
        ...(builtinNames.has(row.name.trim().toLowerCase()) ? { builtin: true } : {}),
        ...(entry?.title === row.name && contribution ? { title: contribution.title } : {}),
      };
    });
    // 闸门开启或验签开关开启时才为市场来源的技能补授权/重装标记；都关闭时不读清单、不做判定。
    const gate = this.gateProbe();
    const described = gate && (gate.enabled('skill') || gate.signatureEnabled?.() === true)
      ? await Promise.all(merged.map(async row => ({ ...row, ...(await this.authStateOf(row.name, gate)) })))
      : merged;
    return described.sort((a, b) => a.name.localeCompare(b.name));
  }

  registerDisplayMetadata(namespace: string, entries: readonly SkillDisplayMetadata[]): () => void {
    if (!skillNamePattern.test(namespace) || namespace === 'workdsh' || entries.length > 256) throw new Error('skill/display-invalid');
    if (this.displayContributions.has(namespace)) throw new Error('skill/display-conflict');
    const rows = new Map<string, SkillDisplayMetadata>();
    for (const entry of entries) {
      if (!skillNamePattern.test(entry.name) || !entry.name.startsWith(`${namespace}-`) || rows.has(entry.name)
        || typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 120
        || /[\r\n\u0000-\u001f]/.test(entry.title)
        || (entry.localizedDescription !== undefined && (typeof entry.localizedDescription !== 'string' || entry.localizedDescription.length > 4000))) throw new Error('skill/display-invalid');
      rows.set(entry.name, Object.freeze({ name: entry.name, title: entry.title.trim(), ...(entry.localizedDescription ? { localizedDescription: entry.localizedDescription } : {}) }));
    }
    // Reject overlapping namespaces/claims instead of letting registration order rename another plugin.
    for (const existing of this.displayContributions.values()) for (const name of rows.keys()) if (existing.has(name)) throw new Error('skill/display-conflict');
    this.displayContributions.set(namespace, rows);
    return () => { if (this.displayContributions.get(namespace) === rows) this.displayContributions.delete(namespace); };
  }

  private contributedDisplay(name: string): Omit<SkillDisplayMetadata, 'name'> | undefined {
    for (const entries of this.displayContributions.values()) {
      const entry = entries.get(name);
      if (entry) return { title: entry.title, ...(entry.localizedDescription ? { localizedDescription: entry.localizedDescription } : {}) };
    }
    return undefined;
  }

  async detail(name: string, signal?: AbortSignal): Promise<ManagedSkillDetail | undefined> {
    const detail = await this.readDetail(name, signal);
    if (!detail) return undefined;
    const metadata = await this.catalogStore.metadata(new Set([detail.name]));
    const entry = metadata.get(detail.name);
    const contribution = this.contributedDisplay(detail.name);
    return { ...detail, ...contribution, ...entry, ...(entry?.title === detail.name && contribution ? { title: contribution.title } : {}) };
  }

  private async readDetail(name: string, signal?: AbortSignal): Promise<ManagedSkillDetail | undefined> {
    this.assertName(name); signal?.throwIfAborted();
    const definition = await this.ctx.skills.get(name, { signal });
    if (definition) {
      try { const detail = await this.fromDefinition(definition); if (detail) return detail; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const active = await this.activeEntry(name);
    if (active) {
      const document = await readFile(active.file, 'utf8');
      const validation = this.validateDocument(document);
      const title = frontmatterValue(document, 'title');
      return {
        name,
        description: validation.description ?? '技能文件需要修复',
        whenToUse: frontmatterValue(document, 'when-to-use'),
        ...(title ? { title } : {}),
        modelInvocable: validation.valid, state: validation.valid ? 'enabled' : 'invalid', manageable: true, document,
        directoryPath: dirname(active.file), revision: digest(document), resources: active.directoryBundle ? await resourceFiles(dirname(active.file)) : [],
        ...(validation.valid ? {} : { diagnostics: validation.diagnostics }),
      };
    }
    const disabled = await this.disabledEntry(name);
    if (!disabled) return undefined;
    const document = await readFile(disabled.file, 'utf8');
    const title = frontmatterValue(document, 'title');
    return {
      name,
      description: frontmatterValue(document, 'description') ?? '已停用技能',
      whenToUse: frontmatterValue(document, 'when-to-use'),
      ...(title ? { title } : {}),
      modelInvocable: false, state: 'disabled', manageable: true, document,
      directoryPath: dirname(disabled.file), revision: digest(document), resources: disabled.directoryBundle ? await resourceFiles(dirname(disabled.file)) : [],
    };
  }

  async update(request: SkillWriteRequest): Promise<ManagedSkillDetail> {
    this.assertName(request.name);
    if (Buffer.byteLength(request.document) > maximumDocumentBytes) throw new Error('skill/document-too-large');
    const metadata = frontmatter(request.document);
    if (metadata.name !== request.name) throw new Error('skill/name-mismatch');
    if (typeof metadata.description !== 'string' || !metadata.description.trim()) throw new Error('skill/description-required');
    return this.withSkillLock(request.name, async () => {
      const current = await this.detail(request.name);
      if (!current?.directoryPath || !current.revision || current.state === 'readonly') throw new Error('skill/not-manageable');
      const skillPath = current.state === 'disabled'
        ? (await this.disabledEntry(request.name))!.file
        : (await this.activeEntry(request.name))?.file;
      if (!skillPath) throw new Error('skill/not-manageable');
      if (digest(await readFile(skillPath, 'utf8')) !== request.expectedRevision) throw new Error('skill/revision-conflict');
      await this.atomicWrite(skillPath, request.document);
      const next = await this.detail(request.name);
      if (!next) throw new Error('skill/reload-failed');
      return next;
    });
  }

  validateDocument(document: string, expectedName?: string): SkillValidationResult {
    const diagnostics: SkillDiagnostic[] = [];
    if (expectedName && Buffer.byteLength(document) > maximumDocumentBytes) diagnostics.push({ code: 'document-too-large', message: 'SKILL.md 超过 1 MiB 上限。', path: 'SKILL.md' });
    let metadata: Record<string, unknown> | undefined;
    try { metadata = frontmatter(document); }
    catch { diagnostics.push({ code: 'invalid-frontmatter', message: 'SKILL.md 必须以有效的 YAML frontmatter 开头。', path: 'SKILL.md' }); }
    const name = typeof metadata?.name === 'string' ? metadata.name.trim() : undefined;
    const description = typeof metadata?.description === 'string' ? metadata.description.trim() : undefined;
    if (!name || !skillNamePattern.test(name) || !isSkillName(name)) diagnostics.push({ code: 'invalid-name', message: 'name 必须是合法的 kebab-case 技能名称。', path: 'SKILL.md' });
    // The official DSH loader identifies a skill by frontmatter name, not its directory.
    // A marketplace slug may differ; only authoring flows enforce an expected name.
    if (expectedName && name && name !== expectedName) diagnostics.push({ code: 'name-mismatch', message: `frontmatter name 必须是 ${expectedName}。`, path: 'SKILL.md' });
    if (!description) diagnostics.push({ code: 'description-required', message: 'description 不能为空。', path: 'SKILL.md' });
    const body = metadata ? document.replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim() : '';
    if (expectedName && metadata && !body) diagnostics.push({ code: 'instructions-required', message: 'frontmatter 后必须包含可执行的技能说明。', path: 'SKILL.md' });
    return { valid: diagnostics.length === 0, ...(name ? { name } : {}), ...(description ? { description } : {}), diagnostics };
  }

  async saveDraft(request: SkillDraftWriteRequest): Promise<SkillDraft> {
    this.assertName(request.name);
    if (Buffer.byteLength(request.document) > maximumDocumentBytes) throw new Error('skill/document-too-large');
    const id = request.id ?? randomUUID();
    if (!draftIdPattern.test(id)) throw new Error('skill/invalid-draft-id');
    const path = this.draftPath(id);
    let current: SkillDraft | undefined;
    try { current = JSON.parse(await readFile(path, 'utf8')) as SkillDraft; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (request.id && (!current || !request.expectedRevision || current.revision !== request.expectedRevision)) throw new Error('skill/revision-conflict');
    if (current && current.name !== request.name) throw new Error('skill/name-mismatch');
    const validation = this.validateDocument(request.document, request.name);
    const updatedAt = new Date().toISOString();
    const revision = digest(`${request.name}\0${request.scope ?? current?.scope ?? 'shared-agents'}\0${request.document}\0${updatedAt}`);
    const draft: SkillDraft = { id, name: request.name, scope: request.scope ?? current?.scope ?? 'shared-agents', document: request.document, revision, updatedAt, validation };
    await this.writeJson(path, draft);
    return draft;
  }

  async getDraft(id: string): Promise<SkillDraft> {
    if (!draftIdPattern.test(id)) throw new Error('skill/invalid-draft-id');
    try {
      const value = JSON.parse(await readFile(this.draftPath(id), 'utf8')) as SkillDraft;
      if (value.id !== id || !skillNamePattern.test(value.name) || typeof value.document !== 'string' || typeof value.revision !== 'string') throw new Error('skill/invalid-draft');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('skill/draft-not-found');
      throw error;
    }
  }

  async publishDraft(id: string, expectedRevision: string): Promise<SkillMutationReceipt> {
    const draft = await this.getDraft(id);
    if (draft.revision !== expectedRevision) throw new Error('skill/revision-conflict');
    const validation = this.validateDocument(draft.document, draft.name);
    if (!validation.valid) throw new Error('skill/draft-invalid');
    return this.withSkillLock(draft.name, async () => {
      const latest = await this.getDraft(id);
      if (latest.revision !== expectedRevision) throw new Error('skill/revision-conflict');
      if (await this.detail(draft.name)) throw new Error('skill/target-exists');
      const root = draft.scope === 'profile' ? this.activeRoots[1] : this.activeRoots[0];
      const target = join(root, draft.name);
      await this.assertAbsent(target); await this.assertAbsent(`${target}.md`);
      await mkdir(target, { recursive: true });
      try {
        await this.atomicWrite(join(target, 'SKILL.md'), draft.document);
        const installed = await readFile(join(target, 'SKILL.md'), 'utf8');
        if (digest(installed) !== digest(draft.document) || !this.validateDocument(installed, draft.name).valid) throw new Error('skill/publish-verification-failed');
        await unlink(this.draftPath(id));
        return { name: draft.name, state: 'enabled', path: target };
      } catch (error) {
        await rm(target, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async readResource(name: string, resourcePath: string): Promise<ManagedSkillResource> {
    const target = await this.resourceTarget(name, resourcePath, false);
    const bytes = await readFile(target);
    if (bytes.byteLength > maximumDocumentBytes) throw new Error('skill/resource-too-large');
    let document: string;
    try { document = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('skill/resource-not-text'); }
    return { path: resourcePath, document, revision: digest(document) };
  }

  async writeResource(request: SkillResourceWriteRequest): Promise<ManagedSkillResource> {
    this.assertName(request.name);
    if (Buffer.byteLength(request.document) > maximumDocumentBytes) throw new Error('skill/resource-too-large');
    return this.withSkillLock(request.name, async () => {
      const target = await this.resourceTarget(request.name, request.path, true);
      let current: string | undefined;
      try { current = await readFile(target, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (current === undefined && request.expectedRevision !== undefined) throw new Error('skill/revision-conflict');
      if (current !== undefined && (request.expectedRevision === undefined || digest(current) !== request.expectedRevision)) throw new Error('skill/revision-conflict');
      await mkdir(dirname(target), { recursive: true });
      await this.assertResourceParent(request.name, dirname(target));
      await this.atomicWrite(target, request.document);
      return { path: request.path, document: request.document, revision: digest(request.document) };
    });
  }

  private async importSource(source: string): Promise<string> {
    const path = resolve(source);
    if (this.importRoot !== undefined) {
      if (!inside(this.importRoot, path)) throw new Error('skill/import-outside-member-root');
      const [root, canonical] = await Promise.all([realpath(this.importRoot), realpath(path)]);
      if (root !== this.importRoot || !inside(root, canonical)) throw new Error('skill/import-outside-member-root');
    }
    return path;
  }

  async inspectImport(source: string, signal?: AbortSignal): Promise<SkillImportInspection> {
    const resolvedSource = await this.importSource(source);
    const inspected = await inspectImportTree(resolvedSource, signal);
    const metadata = frontmatter(inspected.document);
    const name = typeof metadata.name === 'string' ? metadata.name.trim() : undefined;
    const description = typeof metadata.description === 'string' ? metadata.description.trim() : undefined;
    if (!name || !skillNamePattern.test(name) || !isSkillName(name)) throw new Error('skill/invalid-name');
    if (!description) throw new Error('skill/description-required');
    return { name, description, files: inspected.files, totalBytes: inspected.totalBytes };
  }

  async installImport(request: SkillImportRequest, signal?: AbortSignal): Promise<SkillMutationReceipt> {
    signal?.throwIfAborted();
    const source = await this.importSource(request.source);
    const inspected = await inspectImportTree(source, signal);
    const metadata = frontmatter(inspected.document);
    const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
    const description = typeof metadata.description === 'string' ? metadata.description.trim() : '';
    if (!skillNamePattern.test(name) || !isSkillName(name)) throw new Error('skill/invalid-name');
    if (!description) throw new Error('skill/description-required');
    return this.withSkillLock(name, async () => {
      signal?.throwIfAborted();
      // A name is global from the user's point of view. Reject collisions in every
      // official root and with bundled/remote providers instead of creating a
      // second candidate whose winner depends on provider order.
      if (await this.detail(name, signal)) throw new Error('skill/target-exists');
      const root = request.scope === 'profile' ? this.activeRoots[1] : this.activeRoots[0];
      const target = join(root, name);
      await this.assertAbsent(target); await this.assertAbsent(`${target}.md`); await mkdir(root, { recursive: true });
      const temporary = join(root, `.workdsh-import-${name}-${process.pid}-${Date.now()}`);
      try {
        await copyImportTree(source, temporary, signal);
        const copied = await inspectImportTree(temporary, signal);
        if (frontmatterValue(copied.document, 'name') !== name || copied.fingerprint !== inspected.fingerprint) throw new Error('skill/import-verification-failed');
        signal?.throwIfAborted();
        await rename(temporary, target);
        // 导入落盘即写「自建」来源清单；市场与内置目录安装会在之后覆盖成各自来源。
        await this.recordManifest(target, { assetType: 'skill', name, source: 'local' });
        return { name, state: 'enabled', path: target };
      } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
      }
    });
  }

  async setEnabled(name: string, enabled: boolean): Promise<SkillMutationReceipt> {
    this.assertName(name);
    return this.withSkillLock(name, async () => {
      if (enabled) {
        const disabled = await this.disabledEntry(name);
        if (!disabled) throw new Error('skill/not-disabled');
        if (await this.activeEntry(name)) throw new Error('skill/target-exists');
        // 用户手动启用即视为覆盖闸门的自动禁用：先取后台编号，启用成功后清除撤权标记。
        const gateManifest = await this.installManifest(name);
        const origin = await this.disabledOrigin(name);
        const target = origin?.originalEntry ?? join(this.activeRoots[0], disabled.directoryBundle ? name : `${name}.md`);
        if (!this.rootFor(target)) throw new Error('skill/path-outside-managed-roots');
        await this.assertAbsent(target); await mkdir(dirname(target), { recursive: true }); await rename(disabled.entry, target);
        await this.moveSidecar(disabled.entry, target, disabled.directoryBundle);
        await this.removeJson(this.originPath(name));
        this.clearGateMark('skill', gateManifest?.assetId);
        return { name, state: 'enabled', path: target };
      }
      const current = await this.detail(name);
      if (!current?.directoryPath || (current.state !== 'enabled' && current.state !== 'invalid')) throw new Error('skill/not-manageable');
      const active = await this.activeEntry(name);
      if (!active) throw new Error('skill/not-manageable');
      const target = join(this.disabledRoot, active.directoryBundle ? name : `${name}.md`);
      await this.assertAbsent(target); await mkdir(this.disabledRoot, { recursive: true });
      await this.writeJson(this.originPath(name), { name, originalEntry: active.entry, directoryBundle: active.directoryBundle } satisfies DisabledOrigin);
      try { await rename(active.entry, target); }
      catch (error) { await this.removeJson(this.originPath(name)); throw error; }
      await this.moveSidecar(active.entry, target, active.directoryBundle);
      return { name, state: 'disabled', path: target };
    });
  }

  registerDependencyInspector(inspector: SkillDependencyInspector): () => void {
    this.dependencyInspectors.add(inspector);
    return () => this.dependencyInspectors.delete(inspector);
  }

  async dependencyImpact(name: string): Promise<SkillDependencyImpact> {
    this.assertName(name);
    const current = await this.detail(name);
    if (!current?.manageable) throw new Error('skill/not-manageable');
    const nested = await Promise.all([...this.dependencyInspectors].map(inspector => inspector(name)));
    const dependents = nested.flat().sort((a, b) => `${a.kind}\0${a.id}`.localeCompare(`${b.kind}\0${b.id}`));
    const revision = digest(JSON.stringify(dependents.map(item => [item.kind, item.id, item.label, item.blocking])));
    return { name, revision, dependents };
  }

  async uninstall(name: string, expectedImpactRevision: string): Promise<SkillMutationReceipt> {
    this.assertName(name);
    return this.withSkillLock(name, async () => {
      const impact = await this.dependencyImpact(name);
      if (impact.revision !== expectedImpactRevision) throw new Error('skill/dependency-impact-changed');
      if (impact.dependents.some(item => item.blocking)) throw new Error('skill/dependency-blocked');
      const current = await this.detail(name);
      if (!current?.directoryPath || current.state === 'readonly') throw new Error('skill/not-manageable');
      const disabled = current.state === 'disabled' ? await this.disabledEntry(name) : undefined;
      const active = current.state === 'enabled' || current.state === 'invalid' ? await this.activeEntry(name) : undefined;
      const entry = disabled?.entry ?? active?.entry;
      if (!entry) throw new Error('skill/not-manageable');
      const origin = current.state === 'disabled' ? await this.disabledOrigin(name) : undefined;
      // 卸载后清单随资产一起进回收站，撤权标记必须在此刻用原编号清除。
      const gateManifest = await this.installManifest(name);
      const originalEntry = origin?.originalEntry ?? active?.entry ?? join(this.activeRoots[0], disabled?.directoryBundle ? name : `${name}.md`);
      const removedAt = new Date().toISOString();
      const id = `${name}-${removedAt.replace(/[:.]/g, '-')}`;
      const target = join(this.trashRoot, `${id}${extname(entry)}`);
      const receipt: TrashReceipt = { id, name, removedAt, previousState: current.state === 'disabled' ? 'disabled' : 'enabled', originalEntry, trashedEntry: target, directoryBundle: disabled?.directoryBundle ?? active!.directoryBundle };
      await mkdir(this.trashRoot, { recursive: true });
      await this.writeJson(this.receiptPath(id), receipt);
      try { await rename(entry, target); }
      catch (error) { await this.removeJson(this.receiptPath(id)); throw error; }
      await this.moveSidecar(entry, target, receipt.directoryBundle);
      await this.removeJson(this.originPath(name));
      this.clearGateMark('skill', gateManifest?.assetId);
      return { name, state: 'uninstalled', path: target };
    });
  }

  async batch(request: SkillBatchRequest): Promise<SkillBatchResult> {
    if (!Array.isArray(request.names) || request.names.length === 0 || request.names.length > 100) throw new Error('skill/invalid-batch');
    const names = [...new Set(request.names)];
    for (const name of names) this.assertName(name);
    const results = [];
    for (const name of names) {
      try {
        const receipt = request.action === 'enable'
          ? await this.setEnabled(name, true)
          : request.action === 'disable'
            ? await this.setEnabled(name, false)
            : await this.dependencyImpact(name).then(impact => this.uninstall(name, impact.revision));
        results.push({ name, ok: true as const, receipt });
      } catch (error) {
        results.push({ name, ok: false as const, error: error instanceof Error ? error.message : 'skill/internal' });
      }
    }
    return { action: request.action, results };
  }

  /**
   * 闸门用途：读取技能的安装清单。
   *
   * 目录形态读目录内的隐藏清单；单文件形态读同目录旁挂清单，并要求清单里记的文件摘要
   * 与磁盘现状一致（不一致视为清单失效）。只认清单文件本身：启用类动作据此判定来源，
   * 不再按名字、目录成员身份、形态或前缀猜测。没有清单返回 undefined，由调用方按「用户自建」处理。
   */
  async installManifest(name: string): Promise<(AssetManifest & { readonly assetType: 'skill' }) | undefined> {
    this.assertName(name);
    const entry = (await this.activeEntry(name)) ?? (await this.disabledEntry(name));
    if (!entry) return undefined;
    if (entry.directoryBundle) {
      const manifest = await readAssetManifest(dirname(entry.file));
      // 类型不符的清单按「没有清单」处理：宁可当作自建，也不误认成别的资产。
      return manifest && manifest.assetType === 'skill' ? { ...manifest, assetType: 'skill' } : undefined;
    }
    // 单文件技能：旁挂清单必须与磁盘上的文件摘要一致，否则按「清单失效」处理（等同没有清单）。
    if (!(await verifyAssetFileManifest(entry.file)).ok) return undefined;
    const manifest = await readAssetFileManifest(entry.file);
    return manifest && manifest.assetType === 'skill' ? { ...manifest, assetType: 'skill' } : undefined;
  }

  /**
   * 启用前完整性校验：目录形态比对整目录文件清单，单文件形态比对旁挂清单。
   *
   * `options.signature` 为 true（默认）时，市场来源先验签再比文件集合，mtime 不参与结论：
   * 缓存 envelope 超过 24 小时、公钥缺失、验签失败或文件集合不符都按对应原因拒绝。
   * 为 false 时（验签开关关闭）完全跳过验签，但清单内容比对照常执行。
   * 未签名资产沿用「先比存在性/大小/mtime，再算 sha256」的本地快速路径。
   */
  async verifyInstalledIntegrity(
    name: string,
    options: { readonly signature?: boolean } = {},
  ): Promise<
    { readonly ok: true } | {
      readonly ok: false;
      readonly reason:
        | 'missing' | 'file-missing' | 'quick-mismatch' | 'digest-mismatch'
        | 'signature-missing' | 'signature-invalid' | 'signature-asset-mismatch'
        | 'manifest-mismatch' | 'manifest-extra-file';
    }
  > {
    this.assertName(name);
    const entry = (await this.activeEntry(name)) ?? (await this.disabledEntry(name));
    if (!entry) return { ok: false, reason: 'missing' };
    const manifest = entry.directoryBundle
      ? await readAssetManifest(dirname(entry.file))
      : await readAssetFileManifest(entry.file);
    const enforceSignature = options.signature !== false;
    // 清单里带签名块就必须验签：与 source、与验签开关都无关，防止把 source 改成内置绕过。
    if (manifest?.assetType === 'skill' && manifest.signature) {
      return this.verifySignedSkill(entry, manifest);
    }
    // 开关开启时市场来源必须带签名：schema 1 旧清单与关闭期间安装的清单都按「签名缺失」拒绝。
    if (enforceSignature && manifest?.source === 'market') return { ok: false, reason: 'signature-missing' };
    const verdict = entry.directoryBundle
      ? await verifyAssetManifest(dirname(entry.file))
      : await verifyAssetFileManifest(entry.file);
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
  }

  /**
   * 闸门调用期校验：只看「磁盘内容是否仍与安装清单一致」，**不做 Ed25519 验签**。
   *
   * 与 `verifyInstalledIntegrity` 的分工：验签只在安装/启用那道门做（缓存 envelope
   * 与 24 小时新鲜期都只属于那一步）；这里只比文件集合与 sha256 摘要，mtime 不参与结论。
   *
   * 来源口径：
   * - `builtin` 放行：随包发布，开发/打包环境会直接改文件，调用期不该误伤；
   * - `local` 放行：没有授权基准，闸门在调用前已按「未登记」拒绝；
   * - `market` 必须带签名块，否则返回 `signature-missing`（装在验签关闭期，需重装）；
   * - 清单读不到/损坏返回 `unreadable`，由调用方 fail-closed。
   *
   * 结果按「清单摘要 + 磁盘指纹」缓存：同一轮对话反复调用同一技能不再重算 sha256。
   * 缓存失效条件：任一文件的内容/大小/mtime 变化、文件增删、重装改写清单摘要，
   * 都会让 key 变化从而重算。原地篡改且同时保留 size 与 mtime 不会触发重算——
   * 这一层定位是「防误改 + 常规改动」，防篡改基准仍是安装期签名。
   */
  async verifyInstalledDigests(name: string): Promise<SkillDigestVerdict> {
    this.assertName(name);
    const entry = (await this.activeEntry(name)) ?? (await this.disabledEntry(name));
    if (!entry) return { ok: false, reason: 'missing' };
    let manifest: AssetManifest | undefined;
    try {
      manifest = entry.directoryBundle ? await readAssetManifest(dirname(entry.file)) : await readAssetFileManifest(entry.file);
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    if (manifest === undefined || manifest.assetType !== 'skill') return { ok: false, reason: 'unreadable' };
    if (manifest.source !== 'market') return { ok: true };
    if (manifest.signature === undefined) return { ok: false, reason: 'signature-missing' };
    // 清单自身必须自洽：files 与 digest 对不上说明清单被改过，不能再当基准。
    if (assetManifestDigest(manifest.files) !== manifest.digest) return { ok: false, reason: 'manifest-mismatch' };
    const target = entry.directoryBundle ? dirname(entry.file) : entry.file;
    let fingerprint: string;
    try {
      fingerprint = await digestFingerprint(target, entry.directoryBundle);
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
    const key = `${manifest.digest}\0${fingerprint}`;
    const cached = this.digestCache.get(name);
    if (cached?.key === key) return cached.verdict;
    let verdict: SkillDigestVerdict;
    try {
      const files = entry.directoryBundle ? await snapshotAssetFiles(target) : [await snapshotAssetFile(target)];
      verdict = assetManifestDigest(files) === manifest.digest ? { ok: true } : { ok: false, reason: 'digest-mismatch' };
    } catch {
      verdict = { ok: false, reason: 'unreadable' };
    }
    this.digestCache.delete(name);
    this.digestCache.set(name, { key, verdict });
    while (this.digestCache.size > 64) {
      const oldest = this.digestCache.keys().next().value;
      if (oldest === undefined) break;
      this.digestCache.delete(oldest);
    }
    return verdict;
  }

  /**
   * 签名资产的启用前校验：先验签，再比文件集合与清单摘要。
   *
   * 市场来源用运行时缓存（含 24 小时新鲜期）；内置来源的签名随包，没有缓存也没有新鲜期，
   * 直接用清单里的签名块重建 envelope（文件摘要取自清单一侧），仍然做完整验签。
   */
  private async verifySignedSkill(
    entry: { readonly file: string; readonly directoryBundle: boolean },
    manifest: AssetManifest,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason:
    | 'signature-missing' | 'signature-invalid' | 'signature-asset-mismatch'
    | 'manifest-mismatch' | 'manifest-extra-file' }> {
    const signature = manifest.signature;
    if (!signature) return { ok: false, reason: 'signature-missing' };
    const target = entry.directoryBundle ? dirname(entry.file) : entry.file;
    const cached = await readSignatureCache(
      entry.directoryBundle ? assetSignatureCachePath(target) : assetFileSignatureCachePath(target),
    );
    let envelope: AssetSignatureEnvelope;
    let fetchedAt: number | undefined;
    if (cached) {
      if (signature.payloadVersion !== cached.envelope.payloadVersion
        || signature.algo !== cached.envelope.algo
        || signature.keyId !== cached.envelope.keyId
        || signature.digest !== cached.envelope.digest
        || signature.signature !== cached.envelope.signature) {
        return { ok: false, reason: 'signature-invalid' };
      }
      envelope = cached.envelope;
      fetchedAt = cached.fetchedAt;
    } else if (manifest.source === 'builtin') {
      // 内置资产没有本地缓存：编号必须来自构建期写入的签名导出，缺失时不能退化成内容比对。
      if (!manifest.assetId) return { ok: false, reason: 'signature-asset-mismatch' };
      envelope = {
        assetType: 'skill',
        assetId: manifest.assetId,
        payloadVersion: signature.payloadVersion,
        algo: signature.algo,
        keyId: signature.keyId,
        digest: signature.digest,
        signature: signature.signature,
        fileCount: manifest.files.length,
        files: manifest.files.map(file => ({ path: file.path, size: file.size, sha256: file.sha256 })),
        signedAt: manifest.installedAt,
      };
    } else {
      return { ok: false, reason: 'signature-missing' };
    }
    const files = entry.directoryBundle
      ? await snapshotAssetFiles(target)
      : [await snapshotAssetFile(target)];
    const verdict = verifyAssetSignature({
      envelope,
      expectedAssetType: 'skill',
      expectedAssetId: manifest.assetId ?? '',
      files,
      ...(fetchedAt === undefined ? {} : { fetchedAt, maxAgeMs: ASSET_SIGNATURE_FRESHNESS_MS }),
    });
    if (!verdict.ok) {
      const reason = {
        missing: 'signature-missing', invalid: 'signature-invalid', 'asset-mismatch': 'signature-asset-mismatch',
        'manifest-mismatch': 'manifest-mismatch', 'manifest-extra-file': 'manifest-extra-file',
      } as const;
      return { ok: false, reason: reason[verdict.reason] };
    }
    // 清单摘要必须与磁盘现状一致（mtime 不参与；签名资产只认文件集合与哈希）。
    if (assetManifestDigest(files) !== manifest.digest) return { ok: false, reason: 'manifest-mismatch' };
    return { ok: true };
  }

  /**
   * 撤权协调器用途：列出已安装且来源为市场、带后台编号的技能。
   *
   * 只认安装清单，不按名字或目录成员猜来源；启停两侧都扫描，避免用户手动停用后
   * 恰好被撤权的技能漏标。
   */
  async marketAssets(): Promise<readonly { readonly localId: string; readonly assetId: string }[]> {
    const names = new Set<string>();
    for (const root of [...this.activeRoots, this.disabledRoot]) {
      await mkdir(root, { recursive: true });
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const name = entry.isDirectory()
          ? entry.name
          : entry.isFile() && entry.name.endsWith('.md') ? entry.name.slice(0, -3) : undefined;
        if (name && skillNamePattern.test(name)) names.add(name);
      }
    }
    const rows: { localId: string; assetId: string }[] = [];
    for (const name of names) {
      try {
        const manifest = await this.installManifest(name);
        if (manifest?.source === 'market' && manifest.assetId) rows.push({ localId: name, assetId: manifest.assetId });
      } catch {
        // 单个技能读清单失败不影响其余资产；失败按「没有清单」处理，不猜来源。
      }
    }
    return rows;
  }

  private gateProbe(): AssetGateProbe | undefined {
    try {
      return this.ctx.reflect.get('workdshAssetGate') as AssetGateProbe | undefined;
    } catch {
      return undefined;
    }
  }

  /** 用户手动启用/卸载后清除撤权标记；闸门未安装或编号缺失时静默跳过。 */
  private clearGateMark(assetType: string, assetId: string | undefined): void {
    if (!assetId) return;
    try { this.gateProbe()?.clearRevoked(assetType, assetId); } catch { /* 闸门不可用不影响主流程 */ }
  }

  /**
   * 列表授权状态：market 来源且闸门开启时才有值。
   * `revoked` 优先于 `unauthorized`，二者文案都来自闸门 reasons.ts。
   */
  private async authStateOf(
    name: string,
    gate: AssetGateProbe,
  ): Promise<{ readonly authState?: 'unauthorized' | 'revoked' | 'reinstall' | 'error'; readonly authReason?: string }> {
    try {
      const manifest = await this.installManifest(name);
      if (manifest?.source !== 'market' || !manifest.assetId) return {};
      if (gate.revoked('skill', manifest.assetId)) {
        return { authState: 'revoked', authReason: gate.revocationReason().message };
      }
      // 验签开关开启但清单没有签名块：资产装于关闭期间，只能重新安装，不做一次性放行。
      if (gate.signatureEnabled?.() === true && manifest.signature === undefined) {
        return { authState: 'reinstall', authReason: SIGNATURE_REINSTALL_MESSAGE };
      }
      const decision = await gate.decide({ assetType: 'skill', assetId: manifest.assetId, usage: 'use' });
      return decision.allow ? {} : { authState: 'unauthorized', authReason: decision.message };
    } catch {
      // 判定异常不能静默当作正常：按最小权限标记，文案仍取自闸门 reasons.ts。
      return { authState: 'error', authReason: gate.evaluationError().message };
    }
  }

  /**
   * 一次性回填：为已安装但没有清单的技能补写清单（目录与单文件形态都覆盖）。
   *
   * 来源仍按既有记录推定：`market-installs` 命中 → market（并写入后台编号）；
   * 随包内置技能目录命中 → builtin；其余 → local。幂等：已有可用清单的技能跳过，
   * 单条失败只记日志、不阻断启动。
   */
  async backfillInstallManifests(): Promise<{ scanned: number; written: number; failed: number }> {
    const installs = await readMarketInstalls(marketInstallFile(this.stateRoot), message => this.ctx.logger.warn(message));
    const marketIdByName = new Map<string, string>();
    for (const [id, record] of installs) marketIdByName.set(record.name.trim().toLowerCase(), id);
    let scanned = 0; let written = 0; let failed = 0;
    for (const root of [...this.activeRoots, this.disabledRoot]) {
      await mkdir(root, { recursive: true });
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const directory = entry.isDirectory() && skillNamePattern.test(entry.name);
        const file = entry.isFile() && entry.name.endsWith('.md') && skillNamePattern.test(entry.name.slice(0, -3));
        if (!directory && !file) continue;
        scanned += 1;
        try {
          if (await this.backfillManifestAt(join(root, entry.name), directory, marketIdByName)) written += 1;
        } catch (error) {
          failed += 1;
          this.ctx.logger.warn(`技能：回填安装清单失败（${entry.name}）：${describe(error)}。`);
        }
      }
    }
    return { scanned, written, failed };
  }

  /** 回填单条资产；已有清单返回 false。目录形态写目录内清单，单文件形态写同目录旁挂清单。 */
  private async backfillManifestAt(target: string, directory: boolean, marketIdByName: Map<string, string>): Promise<boolean> {
    if (directory ? await readAssetManifest(target) : await readAssetFileManifest(target)) return false;
    const base = basename(target);
    const fallbackName = directory ? base : base.slice(0, -3);
    const document = await readFile(directory ? join(target, 'SKILL.md') : target, 'utf8').catch(() => '');
    const declared = frontmatterValue(document, 'name');
    const name = declared && skillNamePattern.test(declared) ? declared : fallbackName;
    const marketId = marketIdByName.get(name.trim().toLowerCase());
    const source: AssetManifestSource = marketId
      ? 'market'
      : (await this.catalogStore.eligibility(name)).known ? 'builtin' : 'local';
    const installedAt = new Date((await stat(target)).mtimeMs).toISOString();
    const input = { assetType: 'skill' as const, name, source, ...(marketId ? { assetId: marketId } : {}), installedAt };
    if (directory) await writeAssetManifest(target, input);
    else await writeAssetFileManifest(target, input);
    return true;
  }

  /** 写清单失败只记日志：安装本身已成功，清单缺失会让该技能按「用户自建」处理（失败即拒绝）。 */
  private async recordManifest(target: string, input: { assetType: 'skill'; name: string; source: AssetManifestSource; assetId?: string; version?: string; installedAt?: string }): Promise<void> {
    try {
      const info = await lstat(target);
      if (info.isDirectory()) await writeAssetManifest(target, input);
      else await writeAssetFileManifest(target, input);
    } catch (error) { this.ctx.logger.warn(`技能：写入安装清单失败（${input.name}）：${describe(error)}。`); }
  }

  /**
   * 单文件技能改名（禁用 / 启用 / 卸载 / 恢复都是改名）时把旁挂清单一起搬走。
   * 目录形态的清单在目录内，随目录移动，无需处理。搬不动只记日志，不影响技能本身。
   */
  private async moveSidecar(from: string, to: string, directoryBundle: boolean): Promise<void> {
    if (directoryBundle) return;
    const source = assetFileManifestPath(from);
    try { await lstat(source); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.ctx.logger.warn(`技能：检查安装清单失败（${basename(from)}）：${describe(error)}。`);
      return;
    }
    try { await rename(source, assetFileManifestPath(to)); }
    catch (error) { this.ctx.logger.warn(`技能：移动安装清单失败（${basename(from)}）：${describe(error)}。`); }
  }

  async listTrash(): Promise<readonly TrashedSkillSummary[]> {
    await mkdir(this.receiptRoot, { recursive: true });
    const rows: TrashedSkillSummary[] = [];
    for (const entry of await readdir(this.receiptRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const receipt = await this.trashReceipt(entry.name.slice(0, -5));
      if (!receipt) continue;
      try { await lstat(receipt.trashedEntry); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      rows.push({ id: receipt.id, name: receipt.name, removedAt: receipt.removedAt, previousState: receipt.previousState });
    }
    return rows.sort((a, b) => b.removedAt.localeCompare(a.removedAt));
  }

  async restore(id: string): Promise<SkillMutationReceipt> {
    if (!trashIdPattern.test(id)) throw new Error('skill/invalid-trash-id');
    const receipt = await this.trashReceipt(id);
    if (!receipt) throw new Error('skill/trash-not-found');
    return this.withSkillLock(receipt.name, async () => {
      if (await this.activeEntry(receipt.name) || await this.disabledEntry(receipt.name)) throw new Error('skill/target-exists');
      if (!this.rootFor(receipt.originalEntry) || !inside(this.trashRoot, receipt.trashedEntry)) throw new Error('skill/path-outside-managed-roots');
      if (receipt.previousState === 'disabled') {
        const target = join(this.disabledRoot, basename(receipt.originalEntry));
        await this.assertAbsent(target); await mkdir(dirname(target), { recursive: true });
        await this.writeJson(this.originPath(receipt.name), { name: receipt.name, originalEntry: receipt.originalEntry, directoryBundle: receipt.directoryBundle } satisfies DisabledOrigin);
        await rename(receipt.trashedEntry, target);
        await this.moveSidecar(receipt.trashedEntry, target, receipt.directoryBundle);
        await this.removeJson(this.receiptPath(id));
        return { name: receipt.name, state: 'disabled', path: target };
      }
      await this.assertAbsent(receipt.originalEntry); await mkdir(dirname(receipt.originalEntry), { recursive: true });
      await rename(receipt.trashedEntry, receipt.originalEntry); await this.removeJson(this.receiptPath(id));
      await this.moveSidecar(receipt.trashedEntry, receipt.originalEntry, receipt.directoryBundle);
      return { name: receipt.name, state: 'enabled', path: receipt.originalEntry };
    });
  }

  /** Local catalog metadata joined with the current discovery state. */
  async catalog(signal?: AbortSignal): Promise<SkillCatalogSummary> {
    signal?.throwIfAborted();
    const rows = await this.list(signal);
    return this.catalogStore.summary(new Set(rows.map(row => row.name)));
  }

  /**
   * Install one catalog payload. The payload copy is inert until this call, and
   * publication reuses installImport so collision checks, copy verification and
   * the atomic rename have exactly one implementation.
   */
  async installFromCatalog(name: string, scope?: SkillInstallScope, signal?: AbortSignal): Promise<SkillMutationReceipt> {
    this.assertName(name);
    signal?.throwIfAborted();
    const eligibility = await this.catalogStore.eligibility(name);
    if (!eligibility.known) throw new Error('skill/catalog-entry-unknown');
    if (!eligibility.installable) throw new Error('skill/catalog-entry-over-limit');
    const source = await this.catalogStore.payloadPath(name);
    if (!source) throw new Error('skill/catalog-payload-missing');
    const receipt = await this.installImport({ source, scope }, signal);
    // 从内置技能目录安装的副本同样要写清单，来源标为内置：这是「不误拦内置副本」的关键。
    await this.recordManifest(receipt.path, { assetType: 'skill', name, source: 'builtin' });
    return receipt;
  }

  async readCatalogIcon(name: string): Promise<SkillCatalogIcon | undefined> {
    this.assertName(name);
    return this.catalogStore.icon(name);
  }

  private async fromDefinition(definition: SkillDefinition): Promise<ManagedSkillDetail | undefined> {
    // 官方 provider 的 content/metadata 已剥离 frontmatter，显示名由我们自己读取 SKILL.md 解析。
    const source = definition.path ? await readFile(definition.path, 'utf8').catch(() => undefined) : undefined;
    const title = source === undefined ? undefined : frontmatterValue(source, 'title');
    const readonlyDetail: ManagedSkillDetail = {
      name: definition.name, description: definition.description, whenToUse: definition.whenToUse,
      ...(title ? { title } : {}),
      modelInvocable: definition.invocation.modelInvocable, state: 'readonly', manageable: false, resources: [],
    };
    if (!definition.path) return readonlyDetail;
    const active = await this.managedEntryForPath(definition.path);
    if (!active) return readonlyDetail;
    // Harness exposes a canonical instruction path; configured roots may use
    // an OS alias (e.g. /var -> /private/var). Compare actual files only after
    // activeEntry has enforced the managed-root and symlink checks. A winning
    // external skill with the same name must never select the managed copy.
    if (await realpath(definition.path) !== await realpath(active.file)) return readonlyDetail;
    const document = source ?? await readFile(active.file, 'utf8');
    const directory = dirname(active.file);
    return {
      name: definition.name, description: definition.description, whenToUse: definition.whenToUse,
      ...(title ? { title } : {}),
      modelInvocable: definition.invocation.modelInvocable, state: 'enabled', manageable: true,
      document, revision: digest(document), directoryPath: directory, resources: await resourceFiles(directory),
    };
  }

  private isManagedSummary(skill: SkillSummary): boolean {
    return skill.resourceBase?.kind === 'directory' && Boolean(this.rootFor(join(skill.resourceBase.path, 'SKILL.md')));
  }

  private rootFor(path: string): string | undefined { return this.activeRoots.find(root => inside(root, path)); }
  private assertName(name: string): void { if (!skillNamePattern.test(name) || !isSkillName(name)) throw new Error('skill/invalid-name'); }
  private async assertAbsent(path: string): Promise<void> { try { await stat(path); throw new Error('skill/target-exists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  private async disabledEntry(name: string): Promise<{ entry: string; file: string; directoryBundle: boolean } | undefined> {
    for (const entry of [join(this.disabledRoot, name), join(this.disabledRoot, `${name}.md`)]) {
      try {
        const info = await lstat(entry);
        if (info.isSymbolicLink()) throw new Error('skill/path-symlink');
        if (info.isDirectory()) {
          const file = join(entry, 'SKILL.md');
          const fileInfo = await lstat(file);
          if (fileInfo.isSymbolicLink()) throw new Error('skill/path-symlink');
          if (fileInfo.isFile()) return { entry, file, directoryBundle: true };
        }
        if (info.isFile()) return { entry, file: entry, directoryBundle: false };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return undefined;
  }
  private async activeEntry(name: string): Promise<{ entry: string; file: string; directoryBundle: boolean } | undefined> {
    for (const root of this.activeRoots) {
      for (const entry of [join(root, name), join(root, `${name}.md`)]) {
        try {
          const info = await lstat(entry);
          if (info.isSymbolicLink()) throw new Error('skill/path-symlink');
          if (info.isDirectory()) {
            const file = join(entry, 'SKILL.md');
            try {
              const fileInfo = await lstat(file);
              if (fileInfo.isSymbolicLink()) throw new Error('skill/path-symlink');
              if (fileInfo.isFile() && await this.isSafeManagedFile(file)) return { entry, file, directoryBundle: true };
            }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
          if (info.isFile() && await this.isSafeManagedFile(entry)) return { entry, file: entry, directoryBundle: false };
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    const definition = await this.ctx.skills.get(name);
    if (definition?.path) return this.managedEntryForPath(definition.path);
    // Web Profile loads filesystem skills in Agent compositions rather than the
    // top-level registry. Resolve the installed skill's declared name locally.
    for (const root of this.activeRoots) {
      await mkdir(root, { recursive: true });
      for (const row of await readdir(root, { withFileTypes: true })) {
        if (!row.isDirectory() || !skillNamePattern.test(row.name)) continue;
        const entry = join(root, row.name);
        const file = join(entry, 'SKILL.md');
        try {
          if ((await lstat(entry)).isSymbolicLink() || (await lstat(file)).isSymbolicLink() || !await this.isSafeManagedFile(file)) continue;
          if (frontmatterValue(await readFile(file, 'utf8'), 'name') === name) return { entry, file, directoryBundle: true };
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    return undefined;
  }

  private async managedEntryForPath(path: string): Promise<{ entry: string; file: string; directoryBundle: boolean } | undefined> {
    if (!await this.isSafeManagedFile(path)) return undefined;
    const canonical = await realpath(path);
    for (const root of this.activeRoots) {
      let canonicalRoot: string;
      try { canonicalRoot = await realpath(root); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const part = relative(canonicalRoot, canonical);
      const segments = part.split(sep);
      const directoryBundle = segments.length === 2 && segments[1] === 'SKILL.md' && skillNamePattern.test(segments[0]);
      const standalone = segments.length === 1 && segments[0].endsWith('.md') && skillNamePattern.test(segments[0].slice(0, -3));
      if (!directoryBundle && !standalone) continue;
      const entry = join(root, segments[0]);
      const file = directoryBundle ? join(entry, 'SKILL.md') : entry;
      if ((await lstat(entry)).isSymbolicLink() || (await lstat(file)).isSymbolicLink()) throw new Error('skill/path-symlink');
      if (await realpath(file) === canonical) return { entry, file, directoryBundle };
    }
    return undefined;
  }

  private async resourceTarget(name: string, resourcePath: string, allowMissing: boolean): Promise<string> {
    this.assertName(name);
    if (!resourcePath || resourcePath === 'SKILL.md' || resourcePath.includes('\\') || resourcePath.startsWith('/') || resourcePath.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('skill/invalid-resource-path');
    }
    const current = await this.detail(name);
    if (!current?.directoryPath || current.state === 'readonly') throw new Error('skill/not-manageable');
    const target = resolve(current.directoryPath, resourcePath);
    if (!inside(current.directoryPath, target)) throw new Error('skill/invalid-resource-path');
    await this.assertResourceParent(name, dirname(target));
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('skill/path-symlink');
      if (!await this.isSafeManagedFile(target, current.state === 'disabled' ? this.disabledRoot : undefined)) throw new Error('skill/path-outside-managed-roots');
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return target;
  }

  private async assertResourceParent(name: string, parent: string): Promise<void> {
    const current = await this.detail(name);
    if (!current?.directoryPath || !inside(current.directoryPath, parent)) throw new Error('skill/invalid-resource-path');
    let cursor = resolve(parent);
    const root = resolve(current.directoryPath);
    while (inside(root, cursor) && cursor !== root) {
      try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('skill/path-symlink'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      cursor = dirname(cursor);
    }
  }

  private async isSafeManagedFile(path: string, explicitRoot?: string): Promise<boolean> {
    try {
      const resolvedPath = await realpath(path);
      const roots = explicitRoot ? [explicitRoot] : this.activeRoots;
      for (const root of roots) {
        await mkdir(root, { recursive: true });
        if (inside(await realpath(root), resolvedPath)) return true;
      }
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private originPath(name: string): string { return join(this.originRoot, `${name}.json`); }
  private receiptPath(id: string): string { return join(this.receiptRoot, `${id}.json`); }
  private draftPath(id: string): string { return join(this.draftRoot, `${id}.json`); }
  private async disabledOrigin(name: string): Promise<DisabledOrigin | undefined> {
    try {
      const value = JSON.parse(await readFile(this.originPath(name), 'utf8')) as DisabledOrigin;
      return value.name === name && typeof value.originalEntry === 'string' && Boolean(this.rootFor(value.originalEntry)) ? value : undefined;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  private async trashReceipt(id: string): Promise<TrashReceipt | undefined> {
    if (!trashIdPattern.test(id)) return undefined;
    try {
      const value = JSON.parse(await readFile(this.receiptPath(id), 'utf8')) as TrashReceipt;
      return value.id === id && skillNamePattern.test(value.name) && typeof value.originalEntry === 'string' && typeof value.trashedEntry === 'string' ? value : undefined;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  private async atomicWrite(path: string, content: string): Promise<void> {
    const temporary = `${path}.workdsh-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  private async writeJson(path: string, value: object): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await this.atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  private async removeJson(path: string): Promise<void> {
    try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async withSkillLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.lockRoot, { recursive: true });
    const lockPath = join(this.lockRoot, `${name}.lock`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { handle = await open(lockPath, 'wx', 0o600); await handle.writeFile(`${process.pid}\n`); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let age: number;
        try { age = Date.now() - (await stat(lockPath)).mtimeMs; }
        catch (statError) { if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue; throw statError; }
        if (age > 60_000) { await this.removeJson(lockPath); continue; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (!handle) throw new Error('skill/busy');
    try { return await operation(); }
    finally { await handle.close(); await this.removeJson(lockPath); }
  }

  // ── Cross-domain revision capability (D04 dependency adaptation) ──────────
  // Lets an expert freeze an explicit Skill dependency into an immutable snapshot
  // mounted through the official provider, without the consumer walking this
  // plugin's private directories. Frozen content does not freeze source state:
  // checkRevision still reports a disabled/uninstalled source so the expert refuses.

  private retainedRoot(): string { return join(this.stateRoot, 'retained-revisions'); }
  private retentionManifestPath(revisionId: string): string { return join(this.retainedRoot(), `${revisionId}.manifest.json`); }
  private snapshotDirFor(revisionId: string): string { return join(this.retainedRoot(), revisionId); }

  private async readRetentionManifest(path: string): Promise<RetentionManifest | undefined> {
    try { return JSON.parse(await readFile(path, 'utf8')) as RetentionManifest; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }

  async resolveRevision(skillId: string, expectedDigest?: string, signal?: AbortSignal): Promise<SkillRevisionRef> {
    this.assertName(skillId); signal?.throwIfAborted();
    const detail = await this.detail(skillId, signal);
    if (!detail?.directoryPath) throw new Error('skill/revision-source-missing');
    if (detail.state === 'disabled') throw new Error('skill/revision-source-disabled');
    if (detail.state === 'invalid') throw new Error('skill/revision-source-invalid');
    const { contentDigest } = await snapshotFiles(detail.directoryPath, signal);
    if (expectedDigest && expectedDigest !== contentDigest) throw new Error('skill/revision-drift');
    return { skillId, revisionId: `rev-${contentDigest.slice(0, 24)}`, name: skillId, contentDigest };
  }

  async retainRevision(ref: SkillRevisionRef, consumer: SkillConsumerRef, signal?: AbortSignal): Promise<RetainedSkillRevision> {
    this.assertName(ref.skillId); signal?.throwIfAborted();
    return this.withSkillLock(ref.skillId, async () => {
      const snapshotDir = this.snapshotDirFor(ref.revisionId);
      const manifestPath = this.retentionManifestPath(ref.revisionId);
      const target = join(snapshotDir, ref.name);
      const existing = await this.readRetentionManifest(manifestPath);
      if (existing && existing.contentDigest === ref.contentDigest) {
        const current = await snapshotFiles(target, signal);
        if (current.contentDigest !== ref.contentDigest) throw new Error('skill/revision-snapshot-drift');
        const retainedBy = addConsumer(existing.retainedBy, consumer);
        await this.writeJson(manifestPath, { ...existing, retainedBy });
        return { ref, snapshotDir, files: current.files, retainedBy };
      }
      const detail = await this.detail(ref.skillId, signal);
      if (!detail?.directoryPath) throw new Error('skill/revision-source-missing');
      const source = await snapshotFiles(detail.directoryPath, signal);
      if (source.contentDigest !== ref.contentDigest) throw new Error('skill/revision-drift');
      await rm(snapshotDir, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
      for (const file of source.files) {
        const to = join(target, file.path);
        await mkdir(dirname(to), { recursive: true });
        await copyFile(join(detail.directoryPath, file.path), to);
      }
      const retainedBy = addConsumer(existing?.retainedBy ?? [], consumer);
      const manifest: RetentionManifest = { ref, contentDigest: ref.contentDigest, files: source.files, retainedBy, createdAt: new Date().toISOString() };
      await this.writeJson(manifestPath, manifest);
      return { ref, snapshotDir, files: source.files, retainedBy };
    });
  }

  async checkRevision(ref: SkillRevisionRef, _actor: unknown, signal?: AbortSignal): Promise<SkillRevisionCheck> {
    this.assertName(ref.skillId); signal?.throwIfAborted();
    const snapshotDir = this.snapshotDirFor(ref.revisionId);
    const target = join(snapshotDir, ref.name);
    let retained = false;
    let status: SkillRevisionStatus;
    try {
      const snapshot = await snapshotFiles(target, signal);
      retained = true;
      status = snapshot.contentDigest === ref.contentDigest ? 'intact' : 'drifted';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      status = 'missing';
    }
    if (status === 'intact') {
      const detail = await this.detail(ref.skillId, signal);
      if (!detail) status = 'source-uninstalled';
      else if (detail.state === 'disabled') status = 'source-disabled';
    }
    return { ref, status, retained, ...(retained ? { snapshotDir } : {}), ...(status === 'intact' ? {} : { reason: status }) };
  }

  async releaseReference(ref: SkillRevisionRef, consumer: SkillConsumerRef, _signal?: AbortSignal): Promise<void> {
    this.assertName(ref.skillId);
    return this.withSkillLock(ref.skillId, async () => {
      const manifestPath = this.retentionManifestPath(ref.revisionId);
      const manifest = await this.readRetentionManifest(manifestPath);
      if (!manifest) return;
      const retainedBy = manifest.retainedBy.filter((entry) => !(entry.domain === consumer.domain && entry.id === consumer.id));
      if (retainedBy.length === 0) {
        await rm(this.snapshotDirFor(ref.revisionId), { recursive: true, force: true });
        await this.removeJson(manifestPath);
        return;
      }
      await this.writeJson(manifestPath, { ...manifest, retainedBy });
    });
  }
}
