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
  /**
   * 是否内置：取自技能市场安装记录的本地快照（从市场安装且市场标记为内置才为真）。
   * 技能市场可用时界面以市场当前数据为准，该字段只用于市场不可用时的兜底。
   */
  readonly builtin?: boolean;
  /**
   * 授权状态（仅市场来源且闸门开启时有值）：
   * - `unauthorized`：当前账号未获得授权，但仍保留在本机；
   * - `revoked`：授权已失效，已被闸门自动逻辑禁用（与用户手动停用区分）；
   * - `reinstall`：安装于验签开关关闭期间，重开后缺少签名，需重新安装；
   * - `error`：判定过程抛异常，按最小权限处理（不静默当作正常）。
   */
  readonly authState?: 'unauthorized' | 'revoked' | 'reinstall' | 'error';
  /** 与 `authState` 配套的中文原因文案，来自闸门 reasons.ts。 */
  readonly authReason?: string;
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

export type SkillManagementEndpoint = 'list' | 'detail' | 'update' | 'resource' | 'write-resource' | 'set-enabled' | 'dependency-impact' | 'uninstall' | 'batch' | 'trash-list' | 'restore' | 'commit-import' | 'discard-import' | 'catalog' | 'install-catalog' | 'market-available' | 'market-list' | 'market-categories' | 'market-index' | 'market-install' | 'market-uninstall' | 'market-document' | 'listing-options' | 'listing-list' | 'listing-submit' | 'listing-sso';
export interface SkillManagementFailure { readonly code: string; readonly message: string; }
export type SkillManagementResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: SkillManagementFailure };

export type SkillDependencyInspector = (name: string) => Promise<readonly SkillDependency[]> | readonly SkillDependency[];

/** 安装清单的判定视图：只暴露来源判定需要的字段，完整清单由 install-manifest 包提供。 */
export interface SkillInstallManifestView {
  readonly assetType: 'skill';
  readonly name: string;
  readonly source: 'market' | 'builtin' | 'local';
  /** 后台资产编号；builtin 与 local 没有。 */
  readonly assetId?: string;
  readonly installedAt: string;
  readonly version?: string;
}

/**
 * 调用期摘要校验结论：只比文件清单摘要，不做签名验签。
 * `signature-missing` 表示市场来源没有签名块（装在验签关闭期），与内容被改区分开。
 */
export type SkillDigestVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'unreadable' | 'signature-missing' | 'manifest-mismatch' | 'digest-mismatch';
    };

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
  /**
   * 读取该技能的安装清单（资产目录内的隐藏清单文件）。
   * 启用类动作的来源判定只看它：有清单按清单的来源与后台编号处理，
   * 没有清单一律视为用户自建。不按名字或目录成员身份猜测。
   */
  installManifest?(name: string): Promise<SkillInstallManifestView | undefined>;
  /**
   * 撤权协调：列出已安装且来源为市场、带后台编号的技能。
   * 只读安装清单，不按名字或目录成员猜来源。
   */
  marketAssets?(): Promise<readonly { readonly localId: string; readonly assetId: string }[]>;
  /**
   * 启用前完整性校验：目录形态比对文件清单，单文件形态比对旁挂清单。
   * `options.signature` 为 true 时，市场来源先验签再比文件集合（mtime 不参与）；
   * 为 false 时跳过验签，但清单内容比对仍执行（自我一致性不受开关影响）。
   * 返回 `missing` 表示没有清单，由调用方按既有口径处理。
   */
  verifyInstalledIntegrity?(name: string, options?: { readonly signature?: boolean }): Promise<
    { readonly ok: true } | {
      readonly ok: false;
      readonly reason:
        | 'missing' | 'file-missing' | 'quick-mismatch' | 'digest-mismatch'
        | 'signature-missing' | 'signature-invalid' | 'signature-asset-mismatch'
        | 'manifest-mismatch' | 'manifest-extra-file';
    }
  >;
  /**
   * 闸门调用期校验：只比「磁盘内容 vs 安装清单摘要」，不做验签（验签留给安装/启用）。
   * 内置与自建来源返回 ok；市场来源没有签名块时返回 `signature-missing`，
   * 清单读不到或损坏返回 `unreadable`，由调用方 fail-closed。
   */
  verifyInstalledDigests?(name: string): Promise<SkillDigestVerdict>;
  /** 一次性回填：为已安装但没有清单的技能补写清单；幂等、可重复执行。 */
  backfillInstallManifests?(): Promise<{ readonly scanned: number; readonly written: number; readonly failed: number }>;
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
    /** 暂存区当前文件集合：市场安装验签时与服务端签名里的 files 逐项比对（此时尚未落盘）。 */
    snapshot(id: string, signal?: AbortSignal): Promise<readonly { readonly path: string; readonly size: number; readonly sha256: string; readonly mtimeMs: number }[]>;
    commit(id: string, scope?: SkillInstallScope, signal?: AbortSignal): Promise<SkillMutationReceipt>;
    discard(id: string): Promise<void>;
  };
}
