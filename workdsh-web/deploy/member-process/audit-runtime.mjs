import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function auditRuntime(root) {
  root = await realpath(root);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const target = manifest.dependencies?.['@deepseek-ai/dsh'];
  if (typeof target !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(target)) {
    throw new Error('An exact official DSH target is required in the immutable Profile manifest');
  }
  const packages = [], visited = new Set();
  async function scanModules(modules) {
    let entries;
    try { entries = await readdir(modules, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const directories = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(modules, entry.name);
      if (entry.name.startsWith('@')) {
        for (const child of await readdir(path)) directories.push(join(path, child));
      } else directories.push(path);
    }
    for (const path of directories) {
      if (!(await stat(path)).isDirectory()) continue;
      const canonical = await realpath(path);
      if (!canonical.startsWith(root + '/')) throw new Error('Dependency escapes the immutable Profile');
      if (visited.has(canonical)) continue;
      visited.add(canonical);
      try {
        const data = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
        if (data.name === '@deepseek-ai/dsh' || data.name?.startsWith('@deepseek-ai/dsh-')) {
          packages.push({ name: data.name, version: data.version });
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await scanModules(join(path, 'node_modules'));
    }
  }
  await scanModules(join(root, 'node_modules'));
  if (!packages.some(item => item.name === '@deepseek-ai/dsh')) throw new Error('Official DSH package is missing');
  const mismatches = packages.filter(item => item.version !== target);
  if (mismatches.length) throw new Error('Mixed DSH package versions: ' + JSON.stringify(mismatches));
  return { dshVersion: target, officialPackageInstances: packages.length, mixedVersions: false };
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  console.log(JSON.stringify(await auditRuntime(process.argv[2] || '/opt/workdsh/profiles/enterprise')));
}
