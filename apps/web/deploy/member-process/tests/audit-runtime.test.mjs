import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { auditRuntime } from '../audit-runtime.mjs';

test('official package audit rejects a mismatched nested runtime and missing DSH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-runtime-audit-'));
  try {
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'package.json'), JSON.stringify({dependencies:{'@deepseek-ai/dsh':'0.2.0-rc.2'}}));
    await assert.rejects(auditRuntime(root), /missing/);
    const main = join(root, 'node_modules/@deepseek-ai/dsh');
    const nested = join(root, 'node_modules/plugin/node_modules/@deepseek-ai/dsh-fs');
    for (const path of [main, nested]) await mkdir(path, { recursive: true });
    await writeFile(join(main, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' }));
    await writeFile(join(nested, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-fs', version: '0.1.6' }));
    await assert.rejects(auditRuntime(root), /Mixed DSH/);
    await writeFile(join(nested, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-fs', version: '0.2.0-rc.2' }));
    assert.equal((await auditRuntime(root)).officialPackageInstances, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('immutable Profile audit rejects floating targets and dependency links outside the Profile', async () => {
  const root=await mkdtemp(join(tmpdir(),'workdsh-audit-profile-'));
  const outside=await mkdtemp(join(tmpdir(),'workdsh-audit-outside-'));
  try {
    await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{'@deepseek-ai/dsh':'^0.2.0'}}));
    await assert.rejects(auditRuntime(root),/exact official/);
    await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{'@deepseek-ai/dsh':'0.2.0-rc.2'}}));
    await mkdir(join(root,'node_modules'));
    await writeFile(join(outside,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.0-rc.2'}));
    await symlink(outside,join(root,'node_modules','escaped'),'dir');
    await assert.rejects(auditRuntime(root),/escapes the immutable Profile/);
  } finally {await Promise.all([rm(root,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})]);}
});
