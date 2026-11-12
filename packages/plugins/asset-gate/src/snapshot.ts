/**
 * 授权快照的解析与新鲜度判断。
 *
 * 后台回包有两种形态：
 * - 带 revision 且命中：{ revision, unchanged: true }
 * - 其余：{ revision, unchanged: false, staleAt, generatedAt, assets }
 *
 * 快照的生命周期上限由 staleAt 与登录态共同决定；登录态失效由宿主清空缓存来体现。
 */
import { type AssetType, type McpEntitlementEntry, type SnapshotResult } from './types.js';
import { AssetGateError } from './errors.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 解析某一类的授权集合。
 *
 * 严格化约定（见 docs/asset-gate-mcp-tool-auth.md 第十一节）：字段缺失、不是数组、
 * 条目不是字符串，一律按协议错误处理，**不降级为空集合**。空集合会被撤权对账
 * 理解成「没有任何授权」，从而把已装资产整体判为撤权并停掉进程——这是必须区分
 * 「读不懂」与「确实为空」的原因。
 */
function assetIds(type: AssetType, value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new AssetGateError('asset-gate/response-invalid', `授权快照缺少「${type}」的授权集合。`);
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new AssetGateError('asset-gate/response-invalid', `授权快照「${type}」包含无法识别的条目。`);
    }
    const id = item.trim();
    if (!id) throw new AssetGateError('asset-gate/response-invalid', `授权快照「${type}」包含空编号。`);
    ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * 解析连接器条目：`{id, tools?}`。
 *
 * - `tools` 缺省、为 null 或空数组 → 全部工具；
 * - 同一 id 出现多次时取并集，且「任一处未收窄」优先于白名单（避免重复条目把全量升级成白名单）；
 * - 条目顺序与工具名顺序都按字典序归一化，保证本地记录可比较。
 */
function mcpEntries(value: unknown): readonly McpEntitlementEntry[] {
  if (!Array.isArray(value)) {
    throw new AssetGateError('asset-gate/response-invalid', '授权快照缺少「mcp」的授权集合。');
  }
  const merged = new Map<string, { unrestricted: boolean; tools: Set<string> }>();
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      throw new AssetGateError('asset-gate/response-invalid', '授权快照「mcp」包含无法识别的条目。');
    }
    const id = asText(record.id);
    if (!id) throw new AssetGateError('asset-gate/response-invalid', '授权快照「mcp」条目缺少连接器编号。');
    const raw = record.tools;
    let tools: string[] | undefined;
    if (raw !== undefined && raw !== null) {
      if (!Array.isArray(raw)) {
        throw new AssetGateError('asset-gate/response-invalid', `授权快照「mcp」条目 ${id} 的工具清单不是数组。`);
      }
      tools = [];
      for (const name of raw) {
        if (typeof name !== 'string') {
          throw new AssetGateError('asset-gate/response-invalid', `授权快照「mcp」条目 ${id} 的工具名无法识别。`);
        }
        const tool = name.trim();
        if (!tool) throw new AssetGateError('asset-gate/response-invalid', `授权快照「mcp」条目 ${id} 包含空工具名。`);
        tools.push(tool);
      }
    }
    const current = merged.get(id) ?? { unrestricted: false, tools: new Set<string>() };
    if (!tools || tools.length === 0) current.unrestricted = true;
    else for (const tool of tools) current.tools.add(tool);
    merged.set(id, current);
  }
  return [...merged.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, entry]) => (entry.unrestricted || entry.tools.size === 0
      ? { id }
      : { id, tools: [...entry.tools].sort() }));
}

/** 解析快照回包；revision 缺失视为不可识别，避免把旧数据当新数据使用。 */
export function parseSnapshotResult(value: unknown): SnapshotResult {
  const record = asRecord(value);
  if (!record) throw new AssetGateError('asset-gate/response-invalid', '授权快照回包无法识别。');
  const revision = asText(record.revision);
  if (!revision) throw new AssetGateError('asset-gate/response-invalid', '授权快照缺少修订号。');
  if (record.unchanged === true) return { unchanged: true, revision };
  const assets = asRecord(record.assets);
  if (!assets) throw new AssetGateError('asset-gate/response-invalid', '授权快照缺少授权集合。');
  return {
    unchanged: false,
    revision,
    generatedAt: asText(record.generatedAt) || undefined,
    staleAt: asText(record.staleAt) || null,
    assets: {
      skill: assetIds('skill', assets.skill),
      mcp: mcpEntries(assets.mcp),
      expert: assetIds('expert', assets.expert),
      expert_group: assetIds('expert_group', assets.expert_group),
      model: assetIds('model', assets.model),
      knowledge: assetIds('knowledge', assets.knowledge),
      prompt: assetIds('prompt', assets.prompt),
    },
  };
}

/**
 * 本地记录是否是一份「结构完整」的快照。
 *
 * 用于撤权对账的前置条件：只有完整解析过的记录才允许参与「已安装 − 快照」的求差，
 * 损坏或结构不完整的缓存必须跳过对账，不能当成空授权。
 */
export function isCompleteSnapshotRecord(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const assets = asRecord(record.assets);
  if (!assets) return false;
  try {
    assetIds('skill', assets.skill);
    mcpEntries(assets.mcp);
    assetIds('expert', assets.expert);
    assetIds('expert_group', assets.expert_group);
    assetIds('model', assets.model);
    assetIds('knowledge', assets.knowledge);
    assetIds('prompt', assets.prompt);
    return true;
  } catch {
    return false;
  }
}

/**
 * 是否已超过授权时限。空值表示后台未给出时限；无法解析的时间按已过期处理，
 * 宁可拒绝也不把不可信的快照当有效授权。
 */
export function snapshotExpired(staleAt: string | null | undefined, now: number): boolean {
  const raw = staleAt?.trim();
  if (!raw) return false;
  const deadline = Date.parse(raw);
  if (Number.isNaN(deadline)) return true;
  return now >= deadline;
}
