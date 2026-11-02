import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * 市场安装记录：市场条目 id → 本机技能名与最后一次同步的内置属性。
 * 它同时是「技能市场不可用」时的本地兜底快照：是否内置一律以市场为准，
 * 只有取不到市场数据时才用这里记录的值。
 */
export interface MarketInstallRecord {
  /** 本机技能标识（技能包内声明的名称）。 */
  readonly name: string;
  /** 最后一次与技能市场同步的「是否内置」；从未同步过时为缺省。 */
  readonly builtin?: boolean;
}

/** 安装记录文件：与其它技能状态同放在 SkillManager 的状态根下。 */
export function marketInstallFile(stateRoot: string): string {
  return join(stateRoot, 'market-installs.json');
}

const describe = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * 读取安装记录：文件不存在、格式损坏或单条记录无效都按空/跳过处理，不影响列表与安装。
 * 旧格式是「条目 id → 技能名」的纯字符串，继续兼容读取。
 */
export async function readMarketInstalls(file: string, warn: (message: string) => void): Promise<Map<string, MarketInstallRecord>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warn(`技能：读取市场安装记录失败（${describe(error)}）。`);
    return new Map();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
  const rows = new Map<string, MarketInstallRecord>();
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') {
      if (value.trim()) rows.set(id, { name: value.trim() });
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) continue;
    rows.set(id, { name, ...(typeof record.builtin === 'boolean' ? { builtin: record.builtin } : {}) });
  }
  return rows;
}

/** 写回安装记录：失败只影响下次的兜底展示，不阻断安装与列表。 */
export async function writeMarketInstalls(file: string, rows: ReadonlyMap<string, MarketInstallRecord>, warn: (message: string) => void): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify(Object.fromEntries(rows), null, 2)}\n`, { mode: 0o600 });
  } catch (error) {
    warn(`技能：写入市场安装记录失败（${describe(error)}）。`);
  }
}
