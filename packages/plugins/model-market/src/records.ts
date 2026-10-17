/** 模型安装记录：只记录路由、模型标识与分组哈希，不保存任何密钥。 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface InstallRecord {
  /** market：后台授权模型；custom：本机自定义模型。旧记录缺省视为 market。 */
  readonly kind?: 'market' | 'custom';
  /** llm-pi-ai 的 provider 路由名。 */
  readonly route: string;
  /** pi-ai 路由里的模型 id（后台 modelCode）；自定义模型为空字符串。 */
  readonly modelCode: string;
  /** 自定义模型一次写入多个模型时记录全部 id，卸载时整条路由移除。 */
  readonly modelCodes?: readonly string[];
  /** provider + 协议 + 地址 + 密钥的哈希，用于判断哪些模型应聚合到同一路由。 */
  readonly groupHash: string;
  /** 该路由使用的凭据引用名。 */
  readonly credentialRef: string;
  readonly installedAt: string;
}

export interface MarketRecordFile {
  readonly version: 1;
  /** 后台模型主键 → 本机安装记录。 */
  readonly installs: Record<string, InstallRecord>;
  /** 已成功处理过的默认模型（或明确不支持安装的默认模型），避免重复自动安装。 */
  readonly handledDefaults: readonly string[];
  /** 用户主动卸载过的默认模型：之后启动不再自动装回。 */
  readonly dismissedDefaults: readonly string[];
}

const empty = (): MarketRecordFile => ({ version: 1, installs: {}, handledDefaults: [], dismissedDefaults: [] });

export function marketRecordFile(): string {
  const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  return join(dshHome, '.workdsh-state', 'models', 'market-installs.json');
}

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.flatMap(item => typeof item === 'string' && item ? [item] : []))] : [];

/** 读取安装记录；文件缺失或损坏时回退为空记录，不让市场页整体不可用。 */
export async function readMarketRecords(file = marketRecordFile()): Promise<MarketRecordFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return empty();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();
  const row = parsed as Record<string, unknown>;
  const installs: Record<string, InstallRecord> = {};
  const rawInstalls = row.installs;
  if (rawInstalls && typeof rawInstalls === 'object' && !Array.isArray(rawInstalls)) {
    for (const [id, value] of Object.entries(rawInstalls as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      const route = text(item.route);
      const modelCode = text(item.modelCode);
      const modelCodes = strings(item.modelCodes);
      const groupHash = text(item.groupHash);
      const credentialRef = text(item.credentialRef);
      const installedAt = text(item.installedAt);
      const kind = item.kind === 'custom' ? 'custom' : 'market';
      if (!id || !route || !groupHash || !credentialRef) continue;
      if (kind === 'market' && !modelCode) continue;
      if (kind === 'custom' && modelCodes.length === 0) continue;
      installs[id] = {
        kind, route, modelCode, groupHash, credentialRef, installedAt,
        ...(kind === 'custom' ? { modelCodes } : {}),
      };
    }
  }
  return {
    version: 1,
    installs,
    handledDefaults: strings(row.handledDefaults),
    dismissedDefaults: strings(row.dismissedDefaults),
  };
}

/** 原子写入：先写同目录临时文件再 rename，避免进程中断留下半截 JSON。 */
export async function writeMarketRecords(value: MarketRecordFile, file = marketRecordFile()): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({
    version: 1,
    installs: value.installs,
    handledDefaults: [...new Set(value.handledDefaults)],
    dismissedDefaults: [...new Set(value.dismissedDefaults)],
  }, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, file);
}
