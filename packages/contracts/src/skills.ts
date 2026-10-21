import type { SkillRevisionProvider } from './skill-revisions.js';

/** Presentation only: English name remains the official execution identity. */
export interface SkillDisplayMetadata {
  readonly name: string;
  readonly title: string;
  readonly localizedDescription?: string;
}

/** Local Host skill management contract. Not an enterprise authorization API. */
export type ManagedSkillState = 'enabled' | 'disabled' | 'invalid' | 'readonly';

export interface SkillDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface SkillValidationResult {
  readonly valid: boolean;
  readonly name?: string;
  readonly description?: string;
  readonly diagnostics: readonly SkillDiagnostic[];
}

export interface ManagedSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly modelInvocable: boolean;
  readonly state: ManagedSkillState;
  readonly manageable: boolean;
  readonly diagnostics?: readonly SkillDiagnostic[];
  /** 显示名：来自技能自身 SKILL.md frontmatter 的 title，或本地目录/内置标签提供的更丰富元数据。 */
  readonly title?: string;
  readonly localizedDescription?: string;
  readonly categories?: readonly string[];
  readonly iconUrl?: string;
}

export interface ManagedSkillDetail extends ManagedSkillSummary {
  readonly document?: string;
  readonly revision?: string;
  readonly directoryPath?: string;
  readonly resources: readonly string[];
}

export interface SkillWriteRequest {
  readonly name: string;
  readonly document: string;
  readonly expectedRevision: string;
}

export interface SkillMutationReceipt {
  readonly name: string;
  readonly state: ManagedSkillState | 'uninstalled';
  readonly path: string;
}

export interface SkillDependency {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly blocking: boolean;
}

export interface SkillDependencyImpact {
  readonly name: string;
  readonly revision: string;
  readonly dependents: readonly SkillDependency[];
}

export interface SkillDraft {
  readonly id: string;
  readonly name: string;
  readonly scope: SkillInstallScope;
  readonly document: string;
  readonly revision: string;
  readonly updatedAt: string;
  readonly validation: SkillValidationResult;
}

export interface SkillDraftWriteRequest {
  readonly id?: string;
  readonly expectedRevision?: string;
  readonly name: string;
  readonly scope?: SkillInstallScope;
  readonly document: string;
}

export type SkillBatchAction = 'enable' | 'disable' | 'uninstall';
export interface SkillBatchRequest { readonly names: readonly string[]; readonly action: SkillBatchAction; }
export interface SkillBatchItemResult {
  readonly name: string;
  readonly ok: boolean;
  readonly receipt?: SkillMutationReceipt;
  readonly error?: string;
}
export interface SkillBatchResult { readonly action: SkillBatchAction; readonly results: readonly SkillBatchItemResult[]; }

export interface ManagedSkillResource {
  readonly path: string;
  readonly document: string;
  readonly revision: string;
}

export interface SkillResourceWriteRequest {
  readonly name: string;
  readonly path: string;
  readonly document: string;
  readonly expectedRevision?: string;
}

export interface TrashedSkillSummary {
  readonly id: string;
  readonly name: string;
  readonly removedAt: string;
  readonly previousState: 'enabled' | 'disabled';
}

/**
 * One entry of the WorkDSH-owned local skill catalog. Metadata and an inert
 * payload copy live under the shared Agents home; installation goes through the
 * existing import path, so the official provider stays the execution owner.
 */
export interface SkillCatalogEntry {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly version?: string;
  readonly examples?: readonly string[];
  readonly iconUrl?: string;
  readonly installed: boolean;
  readonly installable: boolean;
  readonly installLimits?: readonly string[];
}

/** `missing`/`invalid` are reported instead of a fabricated empty catalog. */
export type SkillCatalogStatus = 'ready' | 'missing' | 'invalid';

export interface SkillCatalogSummary {
  readonly status: SkillCatalogStatus;
  readonly entries: readonly SkillCatalogEntry[];
  readonly categories: readonly string[];
  readonly generatedAt?: string;
  readonly diagnostics?: readonly SkillDiagnostic[];
}

export interface SkillCatalogIcon {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly revision: string;
}

export type SkillInstallScope = 'shared-agents' | 'profile';
export interface SkillImportInspection {
  readonly name: string;
  readonly description: string;
  readonly files: readonly string[];
  readonly totalBytes: number;
}
export interface SkillImportRequest { readonly source: string; readonly scope?: SkillInstallScope; }
export interface StagedSkillImport {
  readonly id: string;
  readonly fileName: string;
  readonly inspection: SkillImportInspection;
  readonly expiresAt: string;
}

/** 下拉选项：字典与来源节点共用同一展示口径。 */
export interface SkillOption {
  readonly value: string;
  readonly label: string;
}

/** 来源节点：nodeType 为本级/上级/同级/下级，界面按它分组。 */
export interface SkillNodeOption extends SkillOption {
  readonly nodeType: string;
}

/** 业务场景树节点：value 为业务场景 id，children 为空表示叶子。 */
export interface SkillSceneNode {
  readonly value: string;
  readonly label: string;
  readonly children: readonly SkillSceneNode[];
}

/** 上架申请表单需要的全部字典：一次请求取回，避免表单打开时多次往返。 */
export interface SkillListingOptions {
  readonly skillTypes: readonly SkillOption[];
  /** 审批状态：已剔除草稿，直接用于状态下拉与徽标文案。 */
  readonly statuses: readonly SkillOption[];
  readonly nodes: readonly SkillNodeOption[];
  readonly scenes: readonly SkillSceneNode[];
  /** 是否公开：字典 yn 的选项，value 原样作为 isPublic 提交。 */
  readonly publicOptions: readonly SkillOption[];
}

/** 技能附件信息：与后台 skillFileInfo / fjxxList 的字段同名。 */
export interface SkillListingFile {
  readonly fileName: string;
  readonly filePath: string;
  readonly size?: number;
}

/** 上架申请提交：字段与后台 listingRequest 请求体一一对应。 */
export interface SkillListingRequest {
  readonly skillName: string;
  readonly skillNameEn: string;
  readonly skillVersion: string;
  readonly skillType: string;
  /** 业务场景 id，多选用英文逗号连接。 */
  readonly bizScene: string;
  readonly sourceNode: string;
  readonly skillDescr: string;
  /** 自定义标签，多选用英文逗号连接；没有标签时为空串。 */
  readonly customTag: string;
  readonly reason: string;
  /** 是否公开：字典 yn 的 value（如 1/0），原样提交。 */
  readonly isPublic: string;
  readonly icon?: string;
  /** 本地预检通过后的暂存 id：宿主读取暂存文件上传后台后再提交申请。 */
  readonly stagedId: string;
}

/** 我的申请查询：分页、关键词与审批状态都由服务端筛选。 */
export interface SkillListingQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly keyword?: string;
  readonly status?: string;
}

/** 我的一条上架申请。 */
export interface SkillListingItem {
  /** 申请单 id：撤销与详情定位都用它。 */
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  readonly version?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly scenes: readonly string[];
  readonly sceneLabels: readonly string[];
  readonly skillType?: string;
  readonly skillTypeText?: string;
  readonly tags: readonly string[];
  readonly status: string;
  readonly statusText?: string;
  readonly reason?: string;
  readonly sourceNode?: string;
  readonly sourceNodeText?: string;
  readonly createdAt?: string;
  readonly comments?: string;
  readonly files: readonly SkillListingFile[];
}

export interface SkillListingPage {
  readonly items: readonly SkillListingItem[];
  readonly total: number;
  readonly page: number;
}

/** 上传结果：URL 由后台文件服务下发，后续提交申请时原样回传。 */
export interface SkillListingUpload {
  readonly url: string;
  readonly fileName: string;
  readonly size: number;
}

export type SkillManagementEndpoint = 'list' | 'detail' | 'update' | 'resource' | 'write-resource' | 'set-enabled' | 'dependency-impact' | 'uninstall' | 'batch' | 'trash-list' | 'restore' | 'commit-import' | 'discard-import' | 'catalog' | 'install-catalog' | 'market-available' | 'market-list' | 'market-categories' | 'market-index' | 'market-install' | 'market-uninstall' | 'market-document' | 'listing-options' | 'listing-list' | 'listing-submit';
export interface SkillManagementFailure { readonly code: string; readonly message: string; }
export type SkillManagementResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: SkillManagementFailure };

export type SkillDependencyInspector = (name: string) => Promise<readonly SkillDependency[]> | readonly SkillDependency[];

/**
 * Provided as ctx.workdshSkills; consumers inject the service, not its implementation.
 * Extends the cross-domain revision capability so an expert (or other consumer) can
 * freeze an explicit Skill dependency into an immutable snapshot without walking
 * another plugin's private directories.
 */
export interface SkillManagementService extends SkillRevisionProvider {
  readonly contractVersion: 1;
  list(signal?: AbortSignal): Promise<readonly ManagedSkillSummary[]>;
  detail(name: string, signal?: AbortSignal): Promise<ManagedSkillDetail | undefined>;
  readResource(name: string, path: string): Promise<ManagedSkillResource>;
  update(request: SkillWriteRequest): Promise<ManagedSkillDetail>;
  writeResource(request: SkillResourceWriteRequest): Promise<ManagedSkillResource>;
  validateDocument(document: string, expectedName?: string): SkillValidationResult;
  saveDraft(request: SkillDraftWriteRequest): Promise<SkillDraft>;
  getDraft(id: string): Promise<SkillDraft>;
  publishDraft(id: string, expectedRevision: string): Promise<SkillMutationReceipt>;
  inspectImport(source: string, signal?: AbortSignal): Promise<SkillImportInspection>;
  installImport(request: SkillImportRequest, signal?: AbortSignal): Promise<SkillMutationReceipt>;
  setEnabled(name: string, enabled: boolean): Promise<SkillMutationReceipt>;
  /** The consumer owns this registration and must release it with its own effect. */
  registerDependencyInspector(inspector: SkillDependencyInspector): () => void;
  dependencyImpact(name: string): Promise<SkillDependencyImpact>;
  uninstall(name: string, expectedImpactRevision: string): Promise<SkillMutationReceipt>;
  batch(request: SkillBatchRequest): Promise<SkillBatchResult>;
  listTrash(): Promise<readonly TrashedSkillSummary[]>;
  restore(id: string): Promise<SkillMutationReceipt>;
  /** Local catalog metadata joined with the current discovery state. */
  catalog(signal?: AbortSignal): Promise<SkillCatalogSummary>;
  /** Installs one catalog payload through the shared import verification path. */
  installFromCatalog(name: string, scope?: SkillInstallScope, signal?: AbortSignal): Promise<SkillMutationReceipt>;
  /** Scoped title contribution; release with the registering plugin's effect.
   * Existing catalog/user metadata takes precedence. No Skill installation occurs.
   */
  registerDisplayMetadata(namespace: string, entries: readonly SkillDisplayMetadata[]): () => void;
  readCatalogIcon(name: string): Promise<SkillCatalogIcon | undefined>;
  readonly imports: {
    stage(fileName: string, body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<StagedSkillImport>;
    /** 读取预检通过的暂存文件原始字节：上架申请提交时由宿主直接上传后台，不再经渲染层二次传输。 */
    read(id: string): Promise<{ readonly fileName: string; readonly bytes: Uint8Array }>;
    commit(id: string, scope?: SkillInstallScope, signal?: AbortSignal): Promise<SkillMutationReceipt>;
    discard(id: string): Promise<void>;
  };
}
