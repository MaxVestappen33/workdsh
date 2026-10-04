import { copyFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { browserWorkerBundle } from '../src/browser-worker.ts'

/** Share the carrier resources and Electron frameworks; copy only its small launcher. */
export async function prepareBrowserWorker(appContents: string, mainExecutable: string): Promise<void> {
  const contents = join(appContents, 'Helpers', browserWorkerBundle, 'Contents')
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  const executable = join(contents, 'MacOS', 'WorkDSH Browser')
  copyFileSync(mainExecutable, executable)
  copyFileSync(join(appContents, 'Info.plist'), join(contents, 'Info.plist'))
  const plist = join(contents, 'Info.plist')
  for (const command of [
    'Set :CFBundleExecutable WorkDSH Browser',
    'Set :CFBundleName WorkDSH Browser',
    'Set :CFBundleIdentifier io.techflag.dsh.ssh.browser-worker',
    'Add :LSUIElement bool true',
  ]) execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plist])
  symlinkSync('../../../Resources', join(contents, 'Resources'))
  symlinkSync('../../../Frameworks', join(contents, 'Frameworks'))
  // Electron's fuse wire lives in the shared Framework, verified by the existing
  // carrier gate. The helper does not introduce a second Electron installation.
}
