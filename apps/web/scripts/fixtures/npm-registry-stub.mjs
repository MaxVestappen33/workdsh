import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * 最小 npm registry 桩：只实现离线安装真正用到的两个端点（packument 与 tarball），
 * 让真实 pnpm 客户端完整走一遍「从内网仓库装包」的过程，不依赖外网、也不需要 verdaccio。
 *
 * packages 每项：{ name, version, entry, binName?, binShape? }
 * - entry：入口文件的绝对路径，会作为包内 bin 的内容原样打进 tarball；
 * - binName：bin 命令名，默认取去掉 scope 后的包名；
 * - binShape：'object'（默认，bin 是映射）或 'string'（bin 是文件路径），覆盖两种入口解析分支。
 */
export async function startNpmRegistryStub(packages) {
  const workdir = await mkdtemp(join(tmpdir(), 'workdsh-registry-stub-'));
  const tarballs = new Map();
  for (const item of packages) tarballs.set(`${item.name}-${item.version}.tgz`, await packFixture(workdir, item));
  let origin = '';
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const tarball = pathname.split('/-/')[1];
    const record = tarball ? tarballs.get(tarball) : undefined;
    if (record) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(record.bytes.length) });
      response.end(record.bytes);
      return;
    }
    const name = decodeURIComponent(pathname.replace(/^\//u, ''));
    const item = packages.find(candidate => candidate.name === name);
    if (!item) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const packed = tarballs.get(`${item.name}-${item.version}.tgz`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(packumentOf(item, packed, origin)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    /** registry 基址：pnpm 的 --registry 取值，结尾必须带斜杠。 */
    registry: `${origin}/`,
    async close() {
      await new Promise(resolve => server.close(() => resolve()));
      await rm(workdir, { recursive: true, force: true });
    },
  };
}

/** bin 命令名：作用域包的 bin 名是去掉 @scope/ 之后的叶子名。 */
const binNameOf = item => item.binName ?? (item.name.startsWith('@') ? item.name.slice(item.name.indexOf('/') + 1) : item.name);

async function packFixture(workdir, item) {
  const root = join(workdir, item.name);
  const packageDir = join(root, 'package');
  await mkdir(join(packageDir, 'bin'), { recursive: true });
  await writeFile(join(packageDir, 'bin', 'cli.mjs'), await readFile(item.entry));
  const bin = item.binShape === 'string' ? 'bin/cli.mjs' : { [binNameOf(item)]: 'bin/cli.mjs' };
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify({ name: item.name, version: item.version, bin }, null, 2)}\n`);
  const file = join(workdir, `${item.name}-${item.version}.tgz`);
  await run('tar', ['-czf', file, '-C', root, 'package']);
  const bytes = await readFile(file);
  return {
    bytes,
    shasum: createHash('sha1').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}

const packumentOf = (item, packed, origin) => ({
  name: item.name,
  'dist-tags': { latest: item.version },
  versions: {
    [item.version]: {
      name: item.name,
      version: item.version,
      bin: item.binShape === 'string' ? 'bin/cli.mjs' : { [binNameOf(item)]: 'bin/cli.mjs' },
      dist: { tarball: `${origin}/${item.name}/-/${item.name}-${item.version}.tgz`, shasum: packed.shasum, integrity: packed.integrity },
    },
  },
});
