import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { MarketRequestError } from './market.js';

/**
 * 本机包安装能力。市场条目里以包管理器（npx/npm/pnpm…）启动的 stdio MCP，
 * 必须先把 npm 包从内网仓库落到本机，才能用随包 Node 按绝对路径启动。
 *
 * 这份配置由载体（Desktop）从 workdsh-app.json 注入：registry 指向内网 Sonatype Nexus，
 * node/pnpm 指向随包运行时，root 是本机 MCP 安装根目录。载体没有注入时该能力整体缺失：
 * 需要下载依赖的市场条目会明确报错，直接执行的条目（node/python/绝对路径）不受影响。
 */
export interface ConnectorInstallOptions {
  readonly registry: string;
  readonly node: string;
  readonly pnpm: string;
  readonly root: string;
  /** 单次安装的墙钟上限：首次从内网仓库拉全量依赖可能很慢，默认 5 分钟。 */
  readonly timeoutMs?: number;
}

export interface NodePackageInstallation {
  /** 本机安装目录：每次安装前整体清空重建，不保留上一次的包树。 */
  readonly directory: string;
  readonly packageName: string;
  readonly version: string;
  /** 包内可执行入口的绝对路径，启动时作为随包 Node 的第一个参数。 */
  readonly entry: string;
}

const DEFAULT_INSTALL_TIMEOUT_MS = 300_000;
/** 保留的安装日志尾部长度：失败时用它说明真实原因，又不至于把日志灌进界面。 */
const LOG_TAIL_LIMIT = 4_000;
/** 服务标识已被定义 schema 限制为 [A-Za-z0-9_-]{1,32}，直接当目录名不会出现路径逃逸。 */
const serverNamePattern = /^[A-Za-z0-9_-]{1,32}$/u;

/** 从包说明符里取包名：`chrome-devtools-mcp@latest` 与 `@scope/name@1.2.3` 都按最后一个 `@` 切分。 */
export function packageNameOf(spec: string): string {
  const value = spec.trim();
  const at = value.lastIndexOf('@');
  return at > 0 ? value.slice(0, at) : value;
}

/** 每个服务标识一个安装目录，重装前整体清空，避免残留上一次的依赖树。 */
export function installDirectoryOf(root: string, serverName: string): string {
  if (!serverNamePattern.test(serverName))
    throw new MarketRequestError('connector/package-install-failed', `服务标识「${serverName}」不能用作本机安装目录。`);
  return join(root, serverName);
}

/**
 * 从内网仓库把包及其全部依赖装到本机目录，并解析出可执行入口。
 * 安装与解析都在随包 Node + pnpm 上完成，不依赖系统 PATH，也不执行包内脚本。
 */
export async function installNodePackage(options: ConnectorInstallOptions & { serverName: string; spec: string }): Promise<NodePackageInstallation> {
  const packageName = packageNameOf(options.spec);
  if (!packageName) throw new MarketRequestError('connector/package-spec-missing', '市场条目没有提供要安装的包名。');
  const directory = installDirectoryOf(options.root, options.serverName);
  await mkdir(options.root, { recursive: true });
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await addPackage(options, directory);
  return { directory, packageName, ...(await entryOf(directory, packageName)) };
}

/** 卸载本机安装的包：只删除本安装器装出来的目录（根目录之下、且有 pnpm 产物）。 */
export async function removeNodePackage(root: string, serverName: string): Promise<void> {
  if (!serverNamePattern.test(serverName)) return;
  const directory = join(root, serverName);
  if (!resolve(directory).startsWith(resolve(root) + sep)) return;
  if (!existsSync(join(directory, 'package.json'))) return;
  await rm(directory, { recursive: true, force: true });
}

async function addPackage(options: ConnectorInstallOptions & { spec: string }, directory: string): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  const args = [options.pnpm, 'add', '--dir', directory, '--ignore-scripts', '--registry', options.registry, options.spec];
  await new Promise<void>((settle, fail) => {
    let log = '';
    let settled = false;
    const child = spawn(options.node, args, {
      cwd: directory,
      // 随包 Node 是绝对路径，不依赖 PATH；registry 同时通过 argv 与 npm_config 下发，
      // 让 pnpm 在解析元数据和拉 tarball 时都走内网仓库。
      env: { ...process.env, npm_config_registry: options.registry },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) fail(error);
      else settle();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new MarketRequestError('connector/package-install-failed', `依赖下载超时（${Math.round(timeoutMs / 60_000)} 分钟），请确认内网仓库可达后重试。`));
    }, timeoutMs);
    const collect = (chunk: Buffer): void => {
      log = (log + chunk.toString()).slice(-LOG_TAIL_LIMIT);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', () => finish(new MarketRequestError('connector/package-install-failed', '无法启动随包依赖安装工具，请重新安装客户端后重试。')));
    child.once('exit', code => {
      if (code === 0) finish();
      else finish(new MarketRequestError('connector/package-install-failed', `依赖安装失败（退出码 ${String(code)}）：${failureDetail(log)}`));
    });
  });
}

/** 安装失败时取日志尾部最后的实质内容，避免把整段 pnpm 输出抛给用户。 */
function failureDetail(log: string): string {
  const lines = log.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  return lines.slice(-3).join(' ') || '请确认内网仓库中存在该包及其全部依赖。';
}

async function entryOf(directory: string, packageName: string): Promise<{ version: string; entry: string }> {
  const packageRoot = join(directory, 'node_modules', packageName);
  const manifestFile = join(packageRoot, 'package.json');
  if (!existsSync(manifestFile))
    throw new MarketRequestError('connector/package-install-failed', `安装结果里没有找到「${packageName}」，请确认内网仓库中存在该包。`);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as { version?: unknown; bin?: unknown; main?: unknown };
  // bin 是 MCP 服务的正式入口；少数包只发布 main，这里兜底接受，入口错了会在连接诊断里直接暴露。
  const relative = entryRelativeOf(manifest.bin, packageName) ?? (typeof manifest.main === 'string' ? manifest.main : undefined);
  if (!relative) throw new MarketRequestError('connector/package-entry-missing', `「${packageName}」没有可执行入口，无法用它启动 MCP 服务。`);
  const entry = resolve(packageRoot, relative);
  if (!entry.startsWith(resolve(directory) + sep) || !existsSync(entry))
    throw new MarketRequestError('connector/package-entry-missing', `「${packageName}」的可执行入口不在安装目录内。`);
  return { version: typeof manifest.version === 'string' ? manifest.version : '', entry };
}

/** bin 可以是字符串，也可以是「命令名 → 文件」映射：优先取与包名同名的命令，其次取第一项。 */
function entryRelativeOf(bin: unknown, packageName: string): string | undefined {
  if (typeof bin === 'string') return bin.trim() || undefined;
  if (bin === null || typeof bin !== 'object' || Array.isArray(bin)) return undefined;
  const rows = Object.entries(bin as Record<string, unknown>)
    .flatMap(([name, value]) => (typeof value === 'string' && value.trim() ? [[name, value.trim()] as const] : []));
  const leaf = packageName.startsWith('@') ? packageName.slice(packageName.indexOf('/') + 1) : packageName;
  return (rows.find(([name]) => name === leaf) ?? rows[0])?.[1];
}
