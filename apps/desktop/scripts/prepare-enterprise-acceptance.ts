/** Explicit installation into an isolated acceptance Profile, never product bundling. */
import { materializeRuntimeProfile } from '../src/local-runtime.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const [app, home, identity, collaboration] = process.argv.slice(2)
if (!app || !home || !identity || !collaboration) throw new Error('Supply app, isolated home, identity archive and collaboration archive')
const resources = join(app, 'Contents/Resources/workdsh-runtime')
const { profile } = materializeRuntimeProfile(join(resources, 'profiles/workdsh'), home)
const file = join(profile, 'package.json')
const pkg = JSON.parse(readFileSync(file, 'utf8'))
pkg.dependencies ??= {}
pkg.dependencies['workdsh-provider-identity-enterprise'] = 'file:' + resolve(identity)
pkg.dependencies['workdsh-plugin-enterprise-collaboration'] = 'file:' + resolve(collaboration)
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', { mode: 0o600 })
execFileSync(join(resources, 'primary-runtime/dependencies/node/bin/node'), [join(resources, 'primary-runtime/dependencies/pnpm/bin/pnpm.cjs'), '--dir', profile, 'install', '--prod'], { stdio: 'pipe', timeout: 240000 })
