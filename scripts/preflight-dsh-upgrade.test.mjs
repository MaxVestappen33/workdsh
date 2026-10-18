import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectUpgrade, validatePublishedMetadata } from './preflight-dsh-upgrade.mjs';

const version = '0.2.1-alpha.2';
const metadata = name => ({ name, version, dist: { tarball: `https://registry.npmjs.org/${name}/-/package.tgz`, integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}` } });

test('published package evidence must match identity, exact version, registry and SHA-512', () => {
  const value = metadata('@deepseek-ai/dsh');
  assert.equal(validatePublishedMetadata(value, value.name, version).version, version);
  for (const invalid of [
    { ...value, version: '0.2.0-rc.2' },
    { ...value, name: '@deepseek-ai/other' },
    { ...value, dist: { ...value.dist, tarball: 'https://registry.npmjs.org.attacker.test/package.tgz' } },
    { ...value, dist: { ...value.dist, integrity: 'sha512-short' } },
  ]) assert.throws(() => validatePublishedMetadata(invalid, value.name, version));
});

test('preflight separates retired overrides, unavailable direct packages and runtime acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-upgrade-preflight-'));
  try {
    await mkdir(join(root, 'apps/web'), { recursive: true });
    await mkdir(join(root, 'packages/feature'), { recursive: true });
    await writeFile(join(root, 'apps/web/package.json'), JSON.stringify({ devDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' }, pnpm: { overrides: { '@deepseek-ai/dsh-old': '0.2.0-rc.2' } } }));
    await writeFile(join(root, 'packages/feature/package.json'), JSON.stringify({ peerDependencies: { '@deepseek-ai/dsh-api-removed': '0.2.0-rc.2' } }));
    const request = async url => {
      if (url.includes('/feeds/')) return new Response('version: 0.2.0-rc.2\n');
      const name = decodeURIComponent(new URL(url).pathname.split('/')[1]);
      return name === '@deepseek-ai/dsh' ? Response.json(metadata(name)) : new Response('', { status: 404 });
    };
    const report = await inspectUpgrade(root, version, request);
    assert.deepEqual(report.missingDirectPackages, ['@deepseek-ai/dsh-api-removed']);
    assert.deepEqual(report.obsoleteOverrideCandidates, ['@deepseek-ai/dsh-old']);
    assert.equal(report.publicationVerified, false);
    assert.equal(report.desktopCandidateAdvertised, false);
    assert.equal(report.runtimeCompatibilityVerified, false);
    assert.equal(report.desktopFeeds.length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});
