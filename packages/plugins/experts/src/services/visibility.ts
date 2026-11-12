import type { ExpertInstallManifest } from 'workdsh-contracts';

/**
 * 市场专家列表的可见性判定：`market` 且有后台编号 → 按编号判授权；`builtin` → 放行；
 * `local` 或无清单 → 拒绝（市场列表行都来自后台，这里只是防御兜底）。
 *
 * 本地专家列表不做授权过滤：用户自建的草稿必须照常可见，才能编辑并提交上架申请。
 * 清单按需读取：只有对应类型的子闸门开启时才会真正读记录，闸门关闭时完全不碰清单。
 */

export type ExpertAssetType = 'expert' | 'expert_group';

/** 判定只需要清单里的来源与后台编号，避免把安装时间等字段带进纯判定。 */
export type ManifestBasis = Pick<ExpertInstallManifest, 'source' | 'assetId'>;

export interface VisibilityGate {
  enabled(assetType: ExpertAssetType): boolean;
  /** 触发式校验：进市场页/刷新/写操作完成后做一次 revision 比对；旧版闸门没有该方法时跳过。 */
  refreshNow?(): Promise<void>;
  decide(request: { assetType: ExpertAssetType; assetId: string; usage: 'read' }): Promise<{ allow: boolean }>;
}

export interface VisibilitySubject {
  readonly assetType: ExpertAssetType;
  /** 延迟读取，只有该类型子闸门开启时才会被调用。 */
  readonly manifest: () => ManifestBasis | undefined;
}

/**
 * 团队成员没有独立清单，解析到所属专家团记录；自己的清单优先。
 */
export function resolveInstallManifest(
  record: { readonly installManifest?: ExpertInstallManifest; readonly teamParentId?: string } | undefined,
  parent: (expertId: string) => { readonly installManifest?: ExpertInstallManifest } | undefined,
): ExpertInstallManifest | undefined {
  if (!record) return undefined;
  if (record.installManifest) return record.installManifest;
  if (!record.teamParentId) return undefined;
  return parent(record.teamParentId)?.installManifest;
}

/** 单条可见性：子闸门关闭时直接放行且不读清单；否则按清单三支判定。 */
export async function manifestAllows(
  gate: VisibilityGate,
  assetType: ExpertAssetType,
  manifest: () => ManifestBasis | undefined,
): Promise<boolean> {
  if (!gate.enabled(assetType)) return true;
  const current = manifest();
  if (current?.source === 'market' && current.assetId) {
    return (await gate.decide({ assetType, assetId: current.assetId, usage: 'read' })).allow;
  }
  return current?.source === 'builtin';
}

/** 列表可见性过滤：闸门缺失时原样返回，不解析行、不读清单。 */
export async function filterVisible<T>(
  gate: VisibilityGate | undefined,
  rows: readonly T[],
  subjectOf: (row: T) => VisibilitySubject,
): Promise<readonly T[]> {
  if (!gate) return rows;
  // 进市场页签/刷新/写操作后都会走到这里：先做一次 revision 校验（单飞 + 节流）；
  // 两类子闸门都关闭时闸门内部为空操作，不请求接口。
  if (gate.enabled('expert') || gate.enabled('expert_group')) await gate.refreshNow?.();
  const visible: T[] = [];
  for (const row of rows) {
    const subject = subjectOf(row);
    if (await manifestAllows(gate, subject.assetType, subject.manifest)) visible.push(row);
  }
  return visible;
}
