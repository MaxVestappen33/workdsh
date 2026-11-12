/**
 * 授权快照缓存。
 *
 * - 内存缓存以账号键（组织 + 主体）隔离，键不一致立即丢弃，绝不跨账号复用；
 * - 落盘时用 AES-256-GCM 加密，密钥由当前登录令牌经 HKDF 派生，既不落盘也不单独管理；
 * - 解密失败、结构校验失败一律删除并当作没有快照（read/use 会 fail-closed）；
 * - 单纯的读文件 IO 错误保留文件，避免因瞬时故障丢掉本可复用的缓存。
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSnapshotResult } from './snapshot.js';
import type { SnapshotRecord } from './types.js';

const KEY_INFO = 'workdsh-asset-gate/snapshot';
const KEY_SALT = 'workdsh-asset-gate';
const FILE_SUFFIX = '.snapshot';
const ENVELOPE_VERSION = 1;
/** 崩溃残留的临时文件超过该时长才清理，避免误删并发写入中的临时文件。 */
const STALE_TMP_MS = 5 * 60_000;

interface Envelope {
  readonly v: number;
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function deriveKey(secret: string, accountKey: string): Buffer {
  const key = hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(KEY_SALT, 'utf8'), Buffer.from(`${KEY_INFO}/${accountKey}`, 'utf8'), 32);
  return Buffer.from(key);
}

function seal(plaintext: string, secret: string, accountKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, accountKey), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope);
}

function open(sealed: string, secret: string, accountKey: string): string {
  const envelope = asRecord(JSON.parse(sealed)) as Partial<Envelope> | undefined;
  if (envelope?.v !== ENVELOPE_VERSION || typeof envelope.iv !== 'string'
    || typeof envelope.tag !== 'string' || typeof envelope.data !== 'string') {
    throw new Error('snapshot/envelope-invalid');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, accountKey), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
}

function fileName(accountKey: string): string {
  return `${createHash('sha256').update(accountKey).digest('hex').slice(0, 32)}${FILE_SUFFIX}`;
}

/** 还原落盘记录；字段归一化复用快照解析，避免两套校验。 */
function normalizeStored(value: unknown, accountKey: string): SnapshotRecord | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const parsed = parseSnapshotResult({ ...raw, unchanged: false });
  if (parsed.unchanged) return undefined;
  // 拉取时间是本地写入的必填字段：缺失或不可解析视为记录无效，不能补成「现在」而让离线写操作绕过新鲜期。
  const fetchedAt = typeof raw.fetchedAt === 'string' && Number.isFinite(Date.parse(raw.fetchedAt)) ? raw.fetchedAt : undefined;
  if (fetchedAt === undefined) return undefined;
  return {
    accountKey,
    revision: parsed.revision,
    ...(parsed.generatedAt ? { generatedAt: parsed.generatedAt } : {}),
    staleAt: parsed.staleAt ?? null,
    assets: parsed.assets,
    fetchedAt,
  };
}

export class SnapshotStore {
  private cached?: SnapshotRecord;

  constructor(
    private readonly directory?: string,
    private readonly warn?: (message: string) => void,
  ) {}

  /** 读取内存缓存；账号键不一致时立即清空，保证缓存不跨账号复用。 */
  peek(accountKey: string): SnapshotRecord | undefined {
    if (this.cached && this.cached.accountKey !== accountKey) this.cached = undefined;
    return this.cached;
  }

  remember(record: SnapshotRecord): void {
    this.cached = record;
  }

  clear(): void {
    this.cached = undefined;
  }

  /**
   * 按账号读取加密快照。
   * - 读文件 IO 失败：保留文件（下次还能用），返回 undefined 并记 warning；
   * - 解密失败、结构校验失败：删除损坏文件，返回 undefined。
   */
  async load(accountKey: string, secret: string): Promise<SnapshotRecord | undefined> {
    if (!this.directory) return undefined;
    const file = join(this.directory, fileName(accountKey));
    await this.sweepTemporary(accountKey);
    let sealed: string;
    try {
      sealed = await readFile(file, 'utf8');
    } catch (error) {
      // ENOENT 是正常的“还没有缓存”，不记为异常。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.warn?.(`资产闸门：快照缓存读取失败，已保留文件（${file}）：${detail(error)}。`);
      }
      return undefined;
    }
    try {
      const record = normalizeStored(JSON.parse(open(sealed, secret, accountKey)), accountKey);
      if (!record) throw new Error('记录结构无效');
      this.remember(record);
      return record;
    } catch (error) {
      this.warn?.(`资产闸门：快照缓存无法解密或结构无效，已删除（${file}）：${detail(error)}。`);
      await this.remove(file);
      return undefined;
    }
  }

  /** 先更新内存，再尽力加密落盘；落盘失败只影响下次启动的离线可用性。 */
  async save(record: SnapshotRecord, secret: string): Promise<void> {
    this.remember(record);
    if (!this.directory) return;
    const file = join(this.directory, fileName(record.accountKey));
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.sweepTemporary(record.accountKey);
      await writeFile(temporary, seal(JSON.stringify(record), secret, record.accountKey), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, file);
    } catch (error) {
      this.warn?.(`资产闸门：快照缓存写入失败，内存快照仍可用（${file}）：${detail(error)}。`);
      await this.remove(temporary);
    }
  }

  /** 清理本账号前缀下陈旧的中断写入临时文件；清理本身失败不影响读写。 */
  private async sweepTemporary(accountKey: string): Promise<void> {
    const directory = this.directory;
    if (!directory) return;
    const prefix = `${fileName(accountKey)}.`;
    try {
      const names = (await readdir(directory)).filter(name => name.startsWith(prefix) && name.endsWith('.tmp'));
      const now = Date.now();
      await Promise.all(names.map(async name => {
        const file = join(directory, name);
        try {
          if (now - (await stat(file)).mtimeMs >= STALE_TMP_MS) await unlink(file);
        } catch {
          /* 并发删除或文件已不存在：清理是尽力而为 */
        }
      }));
    } catch {
      /* 目录不存在或不可读：清理是尽力而为 */
    }
  }

  private async remove(file: string): Promise<void> {
    try {
      await unlink(file);
    } catch {
      /* 文件不存在或已删除：无需处理 */
    }
  }
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
