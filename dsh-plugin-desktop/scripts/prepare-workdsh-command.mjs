import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
const destination = resolve('build/workdsh-runtime/cli')
mkdirSync(join(destination, 'bin'), { recursive: true })
for (const name of ['command-worker', 'command-cli']) copyFileSync(`lib/${name}.js`, join(destination, `${name}.js`))
copyFileSync('../deepseek-harness/apps/desktop/scripts/command-path.ps1', join(destination, 'command-path.ps1'))
writeFileSync(join(destination, 'bin/dsh'), `#!/bin/sh
set -e
launcher=$0
while [ -L "$launcher" ]; do
  directory=$(CDPATH= cd -- "$(dirname -- "$launcher")" && pwd -P)
  target=$(readlink "$launcher")
  case "$target" in /*) launcher=$target ;; *) launcher=$directory/$target ;; esac
done
runtime=$(CDPATH= cd -- "$(dirname -- "$launcher")/../.." && pwd -P)
exec "$runtime/primary-runtime/dependencies/node/bin/node" "$runtime/cli/command-cli.js" "$@"
`, { mode: 0o755 })
writeFileSync(join(destination, 'bin/dsh.cmd'), '@echo off\r\n"%~dp0..\\..\\primary-runtime\\dependencies\\node\\bin\\node.exe" "%~dp0..\\command-cli.js" %*\r\nexit /b %errorlevel%\r\n')
if (process.platform === 'darwin') {
  const plist = resolve('node_modules/electron/dist/Electron.app/Contents/Info.plist')
  const minimum = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', plist], { encoding: 'utf8' }).trim()
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(minimum)) throw new Error('Invalid Electron minimum system version')
  const arch = process.env.WORKDSH_MAC_ARCH ?? process.arch
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported command helper architecture')
  execFileSync('clang', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-arch', arch === 'arm64' ? 'arm64' : 'x86_64', '-mmacosx-version-min=' + minimum, '../deepseek-harness/apps/desktop/cli/link-entry.c', '-o', join(destination, 'link-entry')], { stdio: 'inherit' })
  execFileSync('codesign', ['--force', '--sign', '-', join(destination, 'link-entry')], { stdio: 'inherit' })
}
