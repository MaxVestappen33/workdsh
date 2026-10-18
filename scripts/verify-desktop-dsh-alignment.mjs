import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION } from '../apps/desktop/scripts/runtime-version.mjs'
import {officialDesktopArtifact} from '../apps/desktop/scripts/official-runtime-provenance.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
const upstream = readJson('upstream.json')
const problems = []
if (upstream.desktopArtifactVersion !== undefined) problems.push('Binary artifact versions must be explicitly locked per target, not hidden behind a global desktopArtifactVersion')
if (upstream.version !== DSH_VERSION || upstream.distribution !== 'published-packages-and-desktop-release') problems.push('Desktop must consume the locked official release version')
for (const target of ['mac-arm64', 'mac-x64', 'win-x64']) {
  try {officialDesktopArtifact(target,upstream)} catch {problems.push('Missing or invalid explicit official binary source lock: ' + target)}
}
for (const workspace of ['apps/desktop']) {
  const manifest = readJson(`${workspace}/package.json`)
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
        problems.push(`${workspace} declares an extra DSH package in ${field}: ${name}`)
      }
    }
  }
}
for (const name of Object.keys(readJson('package.json').resolutions ?? {})) {
  if (name.startsWith('@deepseek-ai/dsh')) problems.push(`root resolution retains old DSH package: ${name}`)
}

if (problems.length) {
  console.error(`Desktop DSH version alignment failed:\n${problems.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Desktop has one npm DSH version ${DSH_VERSION}; binary sources: `+['mac-arm64','mac-x64','win-x64'].map(target=>target+'='+upstream.desktopArtifacts[target].version).join(', '))
}
