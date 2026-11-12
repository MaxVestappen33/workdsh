/**
 * 闸门策略的本地持久化。
 *
 * 策略不含账号信息，因此不按账号隔离；但它决定「闸门是否开启」，一旦被本地改写就能
 * 让闸门整体失效，所以落盘带完整性校验：用本机随机密钥做 HMAC-SHA256，校验不通过
 * 一律当作「没有历史策略」，由服务层走 fail-closed。
 *
 * 读写都是小文件（数百字节）且只发生在启动与策略变化时，使用同步 IO：
 * 这样插件初始化完成时就已经拿到上次策略，首次判定不会出现「全关」的空窗。
 */
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGatePolicy } from './policy.js';
import type { GatePolicy } from './types.js';

const FILE_NAME = 'policy.json';
const TEMP_NAME = 'policy.json.tmp';
const KEY_NAME = 'policy.key';
const ENVELOPE_VERSION = 1;

interface Envelope {
  readonly v: number;
  readonly fetchedAt: string;
  /** 原始策略 JSON 文本；MAC 直接对它计算，避免序列化差异导致误判。 */
  readonly body: string;
  readonly mac: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PolicyStore {
  constructor(
    private readonly directory?: string,
    private readonly warn?: (message: string) => void,
  ) {}

  /** 读取并校验上次成功拉取的策略；缺失、损坏或被改动都返回 undefined。 */
  load(): GatePolicy | undefined {
    const directory = this.directory;
    if (!directory) return undefined;
    const file = join(directory, FILE_NAME);
    let sealed: string;
    try {
      sealed = readFileSync(file, 'utf8');
    } catch (error) {
      // ENOENT 表示还没有历史策略，属正常情况。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.warn?.(`资产闸门：策略缓存读取失败，已按无历史策略处理（${file}）：${detail(error)}。`);
      }
      return undefined;
    }
    try {
      const key = this.readKey();
      if (!key) throw new Error('缺少完整性校验密钥');
      const envelope = asRecord(JSON.parse(sealed)) as Partial<Envelope> | undefined;
      if (envelope?.v !== ENVELOPE_VERSION || typeof envelope.body !== 'string' || typeof envelope.mac !== 'string') {
        throw new Error('缓存结构无效');
      }
      if (createHmac('sha256', key).update(envelope.body, 'utf8').digest('hex') !== envelope.mac) {
        throw new Error('完整性校验失败');
      }
      return parseGatePolicy(JSON.parse(envelope.body));
    } catch (error) {
      this.warn?.(`资产闸门：策略缓存无法校验，已删除并按无历史策略处理（${file}）：${detail(error)}。`);
      this.remove(file);
      return undefined;
    }
  }

  /** 覆盖上次策略；写入失败只影响下次启动能否沿用，不影响本次内存中的策略。 */
  save(policy: GatePolicy): void {
    const directory = this.directory;
    if (!directory) return;
    const file = join(directory, FILE_NAME);
    const temporary = join(directory, TEMP_NAME);
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const key = this.ensureKey();
      const body = JSON.stringify(policy);
      const envelope: Envelope = {
        v: ENVELOPE_VERSION,
        fetchedAt: new Date().toISOString(),
        body,
        mac: createHmac('sha256', key).update(body, 'utf8').digest('hex'),
      };
      writeFileSync(temporary, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, file);
    } catch (error) {
      this.warn?.(`资产闸门：策略缓存写入失败，本次仍使用内存中的策略（${file}）：${detail(error)}。`);
      this.remove(temporary);
    }
  }

  /** 完整性校验密钥：本机随机生成一次，只用于识别「策略文件被改写/替换」。 */
  private readKey(): Buffer | undefined {
    const directory = this.directory;
    if (!directory) return undefined;
    try {
      const key = Buffer.from(readFileSync(join(directory, KEY_NAME), 'utf8').trim(), 'hex');
      return key.length === 32 ? key : undefined;
    } catch {
      return undefined;
    }
  }

  private ensureKey(): Buffer {
    const existing = this.readKey();
    if (existing) return existing;
    const directory = this.directory as string;
    const file = join(directory, KEY_NAME);
    const key = randomBytes(32);
    try {
      // wx：密钥只创建不覆盖，避免并发写把对方刚写入的策略密钥换掉。
      writeFileSync(file, key.toString('hex'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const raced = this.readKey();
        if (raced) return raced;
      }
      throw error;
    }
  }

  private remove(file: string): void {
    try {
      unlinkSync(file);
    } catch {
      /* 文件不存在或已删除：无需处理 */
    }
  }
}
