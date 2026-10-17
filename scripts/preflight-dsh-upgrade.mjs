import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const isDsh = name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-');

// Inspect owned manifests, including current uncommitted packages. No source
// checkout or live Profile is changed by this preflight.
export async function collectRequirements(repositoryRoot) {
  const files = [join(repositoryRoot, 'apps/web/package.json')];
  async function visit(directory, depth = 0) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'package.json') files.push(join(directory, entry.name));
      else if (entry.isDirectory() && depth < 3 && !['node_modules', 'src', 'dist', 'lib', 'tests', 'assets', 'docs'].includes(entry.name)) await visit(join(directory, entry.name), depth + 1);
    }
  }
  await visit(join(repositoryRoot, 'packages'));
  const requirements = new Map();
  for (const file of files) {
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides']) {
      const dependencies = field === 'overrides' ? manifest.pnpm?.overrides : manifest[field];
      for (const [name, version] of Object.entries(dependencies ?? {})) {
        if (!isDsh(name)) continue;
        const uses = requirements.get(name) ?? [];
        uses.push({ manifest: file.slice(repositoryRoot.length + 1), field, version });
        requirements.set(name, uses);
      }
    }
  }
  return requirements;
}

export function validatePublishedMetadata(value, name, version) {
  if (value?.name !== name || value?.version !== version) throw new Error('registry metadata identity mismatch');
  const url = new URL(value.dist?.tarball);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password) throw new Error('registry tarball must use the official npm registry');
  const integrity = value.dist?.integrity;
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity ?? '') || Buffer.from(integrity.slice(7), 'base64').length !== 64) throw new Error('registry metadata lacks a full SHA-512 integrity');
  return { name, version, tarball: url.href, integrity, dependencies: value.dependencies ?? {}, peerDependencies: value.peerDependencies ?? {} };
}

export async function inspectUpgrade(repositoryRoot, version, request = fetch) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('candidate must be an exact version');
  const requirements = await collectRequirements(repositoryRoot);
  const queue = [...new Set(['@deepseek-ai/dsh', ...requirements.keys()])];
  const packages = [];
  async function worker() {
    while (queue.length) {
      const name = queue.shift();
      const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;
      try {
        const response = await request(url, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) {
          packages.push({ name, status: response.status === 404 ? 'not-published' : 'request-failed', httpStatus: response.status, uses: requirements.get(name) ?? [] });
          continue;
        }
        const metadata = validatePublishedMetadata(await response.json(), name, version);
        packages.push({ ...metadata, status: 'published', uses: requirements.get(name) ?? [] });
      } catch (error) { packages.push({ name, status: 'request-failed', error: error.message, uses: requirements.get(name) ?? [] }); }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const desktopFeeds = await Promise.all(['mac-arm64', 'mac-x64', 'win-x64'].map(async target => {
    const url = `https://download.deepseek.com/dsh-desk/feeds/${target}/nightly${target.startsWith('mac') ? '-mac' : ''}.yml`;
    try {
      const response = await request(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return { target, url, status: 'request-failed', httpStatus: response.status };
      const body = await response.text();
      const feedVersion = /^version:\s*([^\s]+)\s*$/m.exec(body)?.[1];
      // Feed presence only establishes availability. Archives still require
      // publisher hashes, byte verification, runtime metadata and GUI gates.
      return { target, url, status: feedVersion === version ? 'candidate-advertised' : 'candidate-not-advertised', feedVersion, metadata: body };
    } catch (error) { return { target, url, status: 'request-failed', error: error.message }; }
  }));
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return {
    candidate: version, checkedAt: new Date().toISOString(),
    packages, desktopFeeds,
    missingDirectPackages: packages.filter(item => item.status === 'not-published' && (item.name === '@deepseek-ai/dsh' || item.uses.some(use => use.field !== 'overrides'))).map(item => item.name),
    obsoleteOverrideCandidates: packages.filter(item => item.status === 'not-published' && item.uses.every(use => use.field === 'overrides')).map(item => item.name),
    publicationVerified: packages.every(item => item.status === 'published' || (item.name !== '@deepseek-ai/dsh' && item.status === 'not-published' && item.uses.every(use => use.field === 'overrides'))),
    desktopCandidateAdvertised: desktopFeeds.every(item => item.status === 'candidate-advertised'),
    runtimeCompatibilityVerified: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const version = process.argv.find(arg => arg.startsWith('--version='))?.slice(10) ?? JSON.parse(await readFile(join(root,'upstream.json'),'utf8')).version;
  const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? join(root, '.artifacts/workdsh-3.0/kernel-preflight.json'));
  const report = await inspectUpgrade(root, version);
  report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ candidate: version, packages: report.packages.length, missingDirectPackages: report.missingDirectPackages, obsoleteOverrideCandidates: report.obsoleteOverrideCandidates, feeds: report.desktopFeeds.map(({ target, status, feedVersion }) => ({ target, status, feedVersion })), runtimeCompatibilityVerified: false, output }, null, 2));
  if (!report.publicationVerified || !report.desktopCandidateAdvertised) process.exitCode = 1;
}
