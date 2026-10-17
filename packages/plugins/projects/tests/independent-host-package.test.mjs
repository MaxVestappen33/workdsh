import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('independent Projects Host entry imports without an unpublished contracts package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-project-package-'));
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  try {
    await mkdir(join(root, 'dist'));
    await mkdir(join(root, 'node_modules/@deepseek-ai'), { recursive: true });
    await copyFile(join(packageRoot, 'package.json'), join(root, 'package.json'));
    await copyFile(join(packageRoot, 'dist/index.js'), join(root, 'dist/index.js'));
    for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-storage-domain', 'zod']) {
      await symlink(join(packageRoot, 'node_modules', name), join(root, 'node_modules', name), 'dir');
    }
    const entry = await import(pathToFileURL(join(root, 'dist/index.js')).href);
    assert.equal(typeof entry.apply, 'function');
    assert.equal(typeof entry.ProjectManager, 'function');
    assert.equal(entry.name, 'workdsh-plugin-projects');
  } finally { await rm(root, { recursive: true, force: true }); }
});
