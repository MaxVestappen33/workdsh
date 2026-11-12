/**
 * 判定原因码的唯一来源。
 *
 * 后续的数据层拦截、工具调用错误文本与界面提示都从这里取码和文案，
 * 不允许在调用方再拼一套字符串，避免同一语义出现多个写法。
 */
import { ASSET_SIGNATURE_REASONS, ASSET_SIGNATURE_REASON_MESSAGES } from 'workdsh-asset-signature';

export const GATE_REASONS = {
  /** 主闸门或该类型子闸门关闭：放行，且不读取快照。 */
  allowedOpen: 'gate/allowed-open',
  /** 命中授权快照。 */
  allowedEntitled: 'gate/allowed-entitled',
  /** 没有可用快照（未登录、已切号、未同步）：读/用类拒绝。 */
  deniedNoSnapshot: 'gate/denied-no-snapshot',
  /** 后台可用但从未成功拉取过策略：按最小权限拒绝，避免屏蔽策略接口绕过闸门。 */
  deniedPolicyUnavailable: 'gate/denied-policy-unavailable',
  /** 快照已超过授权时限或登录态：读/用类拒绝。 */
  deniedExpired: 'gate/denied-expired',
  /** 写操作（安装、启用/恢复）超过 24 小时新鲜期：拒绝，读/用不受影响。 */
  deniedSnapshotStale: 'gate/denied-snapshot-stale',
  /** 快照存在，但该资产 id 不在对应类别中。 */
  deniedNotEntitled: 'gate/denied-not-entitled',
  /** 连接器已授权，但该工具不在工具白名单内（连接器级已通过后才会出现）。 */
  deniedToolNotEntitled: 'gate/denied-tool-not-entitled',
  /** 保留：资产内容与授权记录不一致（第三期完整性校验使用）。 */
  deniedContentModified: 'gate/denied-content-modified',
  /**
   * 调用期完整性校验不通过：已启用的市场资产在启用后被改动，
   * 磁盘内容与安装清单摘要不一致。与 deniedSignatureMissing（装在验签关闭期、
   * 根本没有签名块）区分：前者是「有基准但对不上」，后者是「没有基准」。
   */
  deniedIntegrityBroken: 'gate/denied-integrity-broken',
  /** 数据层启用判定：资产拿不到后台编号（用户自建/导入），既未上架也未登记。 */
  deniedNotListed: 'gate/denied-not-listed',
  /** 保留：资产与授权条目的映射不可信（第四期工具映射使用）。 */
  deniedMappingUntrusted: 'gate/denied-mapping-untrusted',
  /** 撤权治理：授权失效后由闸门自动逻辑禁用（与用户手动停用区分）。 */
  revokedAuthorization: 'gate/revoked-authorization',
  /** 判定过程抛异常：按最小权限拒绝，与「未授权」区分，避免误导运维。 */
  deniedEvaluationError: 'gate/denied-evaluation-error',
  // 资产签名验签失败（客户端资产签名契约）：码值与文案由 workdsh-asset-signature 统一维护。
  deniedSignatureMissing: ASSET_SIGNATURE_REASONS.missing,
  deniedSignatureInvalid: ASSET_SIGNATURE_REASONS.invalid,
  deniedSignatureAssetMismatch: ASSET_SIGNATURE_REASONS.assetMismatch,
  deniedManifestMismatch: ASSET_SIGNATURE_REASONS.manifestMismatch,
  deniedManifestExtraFile: ASSET_SIGNATURE_REASONS.manifestExtraFile,
} as const;

export type GateReasonCode = typeof GATE_REASONS[keyof typeof GATE_REASONS];

/** 稳定原因码对应的中文文案。 */
export const GATE_REASON_MESSAGES: Readonly<Record<GateReasonCode, string>> = {
  [GATE_REASONS.allowedOpen]: '资产闸门未启用，本次放行。',
  [GATE_REASONS.allowedEntitled]: '当前账号已获得该项资产的授权。',
  [GATE_REASONS.deniedNoSnapshot]: '当前没有可用的授权快照，已按最小权限拒绝。',
  [GATE_REASONS.deniedPolicyUnavailable]: '无法获取资产闸门策略，已按最小权限拒绝，请联网后重试。',
  [GATE_REASONS.deniedExpired]: '授权已过期，请联网刷新授权后重试。',
  [GATE_REASONS.deniedSnapshotStale]: '离线时间过长（超过 24 小时未成功同步授权），联网后可继续操作。',
  [GATE_REASONS.deniedNotEntitled]: '当前账号未获得该项资产的授权。',
  [GATE_REASONS.deniedToolNotEntitled]: '当前账号未获得该工具的使用授权。',
  [GATE_REASONS.deniedContentModified]: '资产内容与授权记录不一致，已拒绝。',
  [GATE_REASONS.deniedIntegrityBroken]: '资产内容与安装时的记录不一致（可能已被修改），已拒绝本次调用，请重新从市场安装。',
  [GATE_REASONS.deniedNotListed]: '该资产未上架或未登记，请先提交上架申请，审批通过后从市场安装。',
  [GATE_REASONS.deniedMappingUntrusted]: '工具与授权记录的映射不可信，已拒绝。',
  [GATE_REASONS.revokedAuthorization]: '授权已失效，该资产已被自动停用。',
  [GATE_REASONS.deniedEvaluationError]: '资产判定出现异常，本次操作已按最小权限拒绝，请稍后重试。',
  [GATE_REASONS.deniedSignatureMissing]: ASSET_SIGNATURE_REASON_MESSAGES[ASSET_SIGNATURE_REASONS.missing],
  [GATE_REASONS.deniedSignatureInvalid]: ASSET_SIGNATURE_REASON_MESSAGES[ASSET_SIGNATURE_REASONS.invalid],
  [GATE_REASONS.deniedSignatureAssetMismatch]: ASSET_SIGNATURE_REASON_MESSAGES[ASSET_SIGNATURE_REASONS.assetMismatch],
  [GATE_REASONS.deniedManifestMismatch]: ASSET_SIGNATURE_REASON_MESSAGES[ASSET_SIGNATURE_REASONS.manifestMismatch],
  [GATE_REASONS.deniedManifestExtraFile]: ASSET_SIGNATURE_REASON_MESSAGES[ASSET_SIGNATURE_REASONS.manifestExtraFile],
};

/** 取文案；未知码（例如跨版本数据）回退为最小权限提示。 */
export function gateReasonMessage(reason: string): string {
  return GATE_REASON_MESSAGES[reason as GateReasonCode] ?? GATE_REASON_MESSAGES[GATE_REASONS.deniedNoSnapshot];
}
