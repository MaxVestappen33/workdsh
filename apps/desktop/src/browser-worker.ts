import { dirname, join } from 'node:path'

export const browserWorkerBundle = 'WorkDSH Browser.app'

/** Resolve a native UIElement bundle rather than launching the foreground app. */
export function browserWorkerExecutable(executable: string, platform: NodeJS.Platform, development: boolean): string {
  return platform === 'darwin' && !development
    ? join(dirname(dirname(executable)), 'Helpers', browserWorkerBundle, 'Contents', 'MacOS', 'WorkDSH Browser')
    : executable
}
