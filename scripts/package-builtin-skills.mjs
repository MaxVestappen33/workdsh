#!/usr/bin/env node
/**
 * 把随包发布的 14 个内置技能各打一个 zip，供后台逐个上传建记录。
 *
 * 用法：node scripts/package-builtin-skills.mjs [--out <目录>]
 *
 * 打包规则：
 * - zip 根目录就是含唯一 `SKILL.md` 的那一层，不多套一层目录（`cd <技能目录> && zip .`）；
 * - 逐字节保留文件内容，文件按 UTF-8 字节序排序后写入，仅去掉扩展属性（`-X`）保证可复现；
 * - 排除 `.workdsh-install.json`、`.DS_Store`、`__MACOSX/`、`._*`；
 * - 缺 `SKILL.md` 或存在多个 `SKILL.md` 直接报错并指出技能名，不静默跳过；
 * - 打完读 zip 中央目录自检条目数、总字节数与根层唯一 `SKILL.md`。
 *
 * 输出：`<out>/<技能名>.zip` 与 `<out>/MANIFEST.txt`（`技能名\tzip 文件\tSKILL.md 之外的条目数\tSKILL.md 的 sha256`）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = join(REPO, 'build', 'builtin-skill-packages');
const EXCLUDED_FILES = new Set(['.DS_Store', '.workdsh-install.json', '.workdsh-asset-signature.json']);
const EXCLUDED_DIRS = new Set(['__MACOSX']);

/** 三批随包内置技能的根目录；每个子目录是一个技能，技能名与清单里的 name 一致。 */
const SOURCES = [
  {
    label: 'workdsh 技能插件',
    root: join(REPO, 'packages', 'plugins', 'skills', 'resources', 'skills'),
    names: ['workdsh-excel-design', 'workdsh-ppt-design', 'workdsh-skill-creator', 'workdsh-web-design', 'workdsh-word-design', 'workdsh-workbench-dev'],
  },
  {
    label: 'workdsh 专家插件',
    root: join(REPO, 'packages', 'plugins', 'experts', 'resources', 'skills'),
    names: ['workdsh-expert-manager'],
  },
  {
    label: '官方 office-skills（0.2.1-rc.5 归档）',
    root: join(REPO, 'apps', 'desktop', 'build', 'official-release-cache', 'mac-arm64-0.2.1-rc.5', 'runtime', 'office-skills'),
    names: ['office', 'office-docx', 'office-export-pdf', 'office-pptx', 'office-recalculate', 'office-render', 'office-xlsx'],
  },
];

const comparePaths = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

/** 图标外的东西一律不进包；`.workdsh-install.json` 会被客户端哈希排除，带上反而让签名对不上。 */
function excluded(relativePath) {
  const segments = relativePath.split('/');
  if (segments.some(segment => EXCLUDED_DIRS.has(segment))) return true;
  const name = segments[segments.length - 1];
  return EXCLUDED_FILES.has(name) || name.startsWith('._');
}

/** 列出技能目录下所有要打包的文件，路径为相对技能根的 `/` 分隔形式。 */
async function collect(root) {
  const files = [];
  const visit = async (directory, depth) => {
    if (depth > 8) throw new Error(`目录层级超过 8：${directory}`);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path).split(sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`技能目录内不允许符号链接：${name}`);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await visit(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || excluded(name)) continue;
      const info = await stat(path);
      files.push({ name, size: info.size });
    }
  };
  await visit(root, 0);
  return files.sort((left, right) => comparePaths(left.name, right.name));
}

/** 唯一 SKILL.md 必须就在技能根（zip 根层），否则后台解包会多套一层或认错根。 */
function assertSkillRoot(name, files) {
  const skillFiles = files.filter(file => file.name.split('/').pop() === 'SKILL.md');
  if (skillFiles.length === 0) throw new Error(`技能 ${name} 缺少 SKILL.md`);
  if (skillFiles.length > 1) throw new Error(`技能 ${name} 存在多个 SKILL.md：${skillFiles.map(file => file.name).join(', ')}`);
  const [skillFile] = skillFiles;
  if (skillFile.name !== 'SKILL.md') throw new Error(`技能 ${name} 的 SKILL.md 不在根层：${skillFile.name}`);
}

/** 调系统 zip：`-@` 从 stdin 读白名单，`-D` 不写目录条目，`-X` 去掉 uid/gid 等扩展属性。 */
function writeZip(skillDir, files, target) {
  const result = spawnSync('zip', ['-X', '-D', '-q', '-@', target], {
    cwd: skillDir,
    input: `${files.map(file => file.name).join('\n')}\n`,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`zip 失败（${result.status}）：${result.stderr?.trim() || '无输出'}`);
}

/** 读 zip 中央目录：返回条目名与解压后大小，用于自检而不是信任命令行输出。 */
function readCentralDirectory(buffer) {
  const minimum = 22;
  let eocd = -1;
  for (let index = buffer.length - minimum; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error('不是合法的 zip：找不到中央目录结尾');
  const total = buffer.readUInt16LE(eocd + 10);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (offset === 0xffffffff || total === 0xffff) throw new Error('暂不支持 zip64 自检');
  const entries = [];
  let cursor = offset;
  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`中央目录第 ${index + 1} 条记录损坏`);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    entries.push({ name, size });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function packageSkill(name, root, out) {
  const directory = join(root, name);
  let entries;
  try { entries = await collect(directory); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`技能 ${name} 的源目录不存在：${directory}`);
    throw error;
  }
  assertSkillRoot(name, entries);

  const target = join(out, `${name}.zip`);
  await rm(target, { force: true });
  writeZip(directory, entries, target);

  const buffer = await readFile(target);
  const actual = readCentralDirectory(buffer);
  if (actual.length !== entries.length) throw new Error(`技能 ${name} 条目数不符：期望 ${entries.length}，实际 ${actual.length}`);
  const expectedNames = entries.map(file => file.name);
  const actualNames = actual.map(entry => entry.name);
  for (const [index, expected] of expectedNames.entries()) {
    if (actualNames[index] !== expected) throw new Error(`技能 ${name} 第 ${index + 1} 条不符：期望 ${expected}，实际 ${actualNames[index]}`);
  }
  const roots = actual.filter(entry => entry.name === 'SKILL.md');
  if (roots.length !== 1) throw new Error(`技能 ${name} 的 zip 根层 SKILL.md 数量为 ${roots.length}`);
  if (actual.some(entry => excluded(entry.name))) throw new Error(`技能 ${name} 的 zip 里有应排除的文件`);

  const skillBytes = await readFile(join(directory, 'SKILL.md'));
  return {
    name,
    file: `${name}.zip`,
    entries: actual.length,
    extra: actual.length - 1,
    bytes: actual.reduce((sum, entry) => sum + entry.size, 0),
    zipBytes: buffer.byteLength,
    skillSha256: createHash('sha256').update(skillBytes).digest('hex'),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  let out = DEFAULT_OUT;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      console.error('usage: node scripts/package-builtin-skills.mjs [--out <目录>]');
      process.exit(2);
    }
    out = resolve(argv[index + 1]);
    index += 1;
  }
  await mkdir(out, { recursive: true });

  const rows = [];
  for (const source of SOURCES) {
    console.log(`\n# ${source.label}：${relative(REPO, source.root) || source.root}`);
    for (const name of source.names) {
      const row = await packageSkill(name, source.root, out);
      rows.push(row);
      console.log(`  ${row.file}  条目 ${row.entries}  解压后 ${row.bytes} 字节  压缩后 ${row.zipBytes} 字节`);
    }
  }

  const lines = rows.map(row => `${row.name}\t${row.file}\t${row.extra}\t${row.skillSha256}`);
  await writeFile(join(out, 'MANIFEST.txt'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`\n共 ${rows.length} 个技能，输出目录 ${out}`);
  console.log(`MANIFEST.txt 已写入 ${lines.length} 行`);
}

await main();
