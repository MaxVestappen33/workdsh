/**
 * 撤权账本：记录「因授权失效而自动禁用」的资产。
 *
 * 关键约束：
 * - 与资产自身的用户启用/停用状态完全独立，不使用同一字段表达两种语义；
 * - 账本文件落在 `AssetGateService.stateDir`，Desktop 已按账号注入该目录，
 *   所以标记天然按账号隔离，A 账号撤权不会影响 B 账号；
 * - 只记录 market 来源且带后台编号的资产；本地/内置资产永不进入账本。
 */
import { readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 参与撤权治理的资产类型。模型与提示词没有可停用的本地装载位，不进入账本。 */
export const REVOCABLE_ASSET_TYPES = ['skill', 'mcp', 'expert', 'expert_group'] as const;

export type RevocableAssetType = typeof REVOCABLE_ASSET_TYPES[number];

/** 唯一的来源标记：因授权失效而禁用。 */
export const REVOCATION_CAUSE = 'authorization-revoked' as const;

export interface RevocationEntry {
  readonly disabledAt: string;
  readonly cause: typeof REVOCATION_CAUSE;
}

const LEDGER_FILE = 'revocations.json';
const SCHEMA_VERSION = 1;
const MAX_ASSETS_PER_TYPE = 5_000;

type EntryTable = Record<string, RevocationEntry>;

interface LedgerFile {
  readonly version: number;
  readonly entries: Record<string, EntryTable>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isRevocableType(value: string): value is RevocableAssetType {
  return (REVOCABLE_ASSET_TYPES as readonly string[]).includes(value);
}

function parse(value: unknown): Record<string, EntryTable> {
  const raw = asRecord(value);
  if (raw?.version !== SCHEMA_VERSION) return {};
  const source = asRecord(raw.entries);
  if (!source) return {};
  const entries: Record<string, EntryTable> = {};
  for (const [type, table] of Object.entries(source)) {
    if (!isRevocableType(type)) continue;
    const rows = asRecord(table);
    if (!rows) continue;
    const parsed: EntryTable = {};
    for (const [assetId, entry] of Object.entries(rows)) {
      const row = asRecord(entry);
      // 只认本版本写入的结构；损坏条目直接丢弃，不阻断其余资产。
      if (!assetId || row?.cause !== REVOCATION_CAUSE || typeof row.disabledAt !== 'string') continue;
      parsed[assetId] = { disabledAt: row.disabledAt, cause: REVOCATION_CAUSE };
    }
    if (Object.keys(parsed).length) entries[type] = parsed;
  }
  return entries;
}

export class RevocationLedger {
  private entries: Record<string, EntryTable> = {};
  private write: Promise<void> = Promise.resolve();

  constructor(private readonly directory?: string) {}

  /** 同步读取：服务初始化阶段就要恢复账本，不能等异步 IO。 */
  load(): void {
    if (!this.directory) return;
    try {
      this.entries = parse(JSON.parse(readFileSync(this.file(), 'utf8')));
    } catch {
      // 文件不存在、损坏或不可读：按空账本处理，下一次有变化时整体重写。
      this.entries = {};
    }
  }

  isRevoked(assetType: RevocableAssetType, assetId: string): boolean {
    return this.entries[assetType]?.[assetId] !== undefined;
  }

  /** 已标记的资产编号；调用方只应把它与「当前已安装」集合求交，避免历史残留。 */
  revoked(assetType: RevocableAssetType): readonly string[] {
    return Object.keys(this.entries[assetType] ?? {});
  }

  /** 标记一批资产；返回是否真的发生了变化。 */
  mark(assetType: RevocableAssetType, assetIds: readonly string[]): boolean {
    let changed = false;
    const table = { ...(this.entries[assetType] ?? {}) };
    const disabledAt = new Date().toISOString();
    for (const assetId of assetIds) {
      if (!assetId || table[assetId]) continue;
      if (Object.keys(table).length >= MAX_ASSETS_PER_TYPE) break;
      table[assetId] = { disabledAt, cause: REVOCATION_CAUSE };
      changed = true;
    }
    if (changed) this.entries[assetType] = table;
    return changed;
  }

  /** 清除单个标记；返回是否真的发生了变化。 */
  clear(assetType: RevocableAssetType, assetId: string): boolean {
    const table = this.entries[assetType];
    if (!table?.[assetId]) return false;
    const next = { ...table };
    delete next[assetId];
    if (Object.keys(next).length) this.entries[assetType] = next;
    else delete this.entries[assetType];
    return true;
  }

  /** 账号切换/退出：丢弃内存账本。磁盘文件属于旧账号目录，不做跨账号删除。 */
  clearAccount(): void {
    this.entries = {};
  }

  /** 原子落盘；多次并发保存按调用顺序串行执行，最后一次内容为准。 */
  save(): Promise<void> {
    const directory = this.directory;
    if (!directory) return Promise.resolve();
    const payload: LedgerFile = { version: SCHEMA_VERSION, entries: this.entries };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    const target = this.file();
    this.write = this.write.then(async () => {
      const temporary = `${target}.${process.pid}-${Date.now()}.tmp`;
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, target);
      } catch {
        await unlink(temporary).catch(() => {});
      }
    });
    return this.write;
  }

  private file(): string {
    return join(this.directory!, LEDGER_FILE);
  }
}

/**
 * 单类型撤权重算（纯函数，便于单测）：
 * - 撤权：已安装但不在当前快照里；
 * - 恢复：账本命中且已回到快照与已安装集合。
 *
 * 只依赖传入的编号集合，不读清单、不解析身份；内置与本地资产永远不会出现在
 * `installedIds` 里，因为调用方只传 market + assetId 的记录。
 */
export function reconcileRevocations(
  ledger: RevocationLedger,
  assetType: RevocableAssetType,
  snapshotIds: Iterable<string>,
  installedIds: Iterable<string>,
): { readonly changed: boolean; readonly revoked: readonly string[]; readonly restored: readonly string[] } {
  const snapshot = new Set(snapshotIds);
  const installed = new Set(installedIds);
  const revoked = [...installed].filter(assetId => assetId && !snapshot.has(assetId));
  const restored = ledger.revoked(assetType).filter(assetId => snapshot.has(assetId) && installed.has(assetId));
  let changed = ledger.mark(assetType, revoked);
  for (const assetId of restored) {
    if (ledger.clear(assetType, assetId)) changed = true;
  }
  return { changed, revoked, restored };
}
