import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

/** POSIX permissions are checked explicitly; Windows uses the Main-owned userData ACL. */
export function protectedFilePermissions(mode: number, uid: number, platform: NodeJS.Platform, currentUid?: number): boolean {
  return platform === 'win32' || ((mode & 0o077) === 0 && (currentUid === undefined || uid === currentUid));
}
export async function readProtectedFile(path: string, maximumBytes: number): Promise<string> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Protected account auth file required');
  const file = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > maximumBytes || opened.ino !== before.ino || opened.dev !== before.dev ||
        !protectedFilePermissions(opened.mode, opened.uid, process.platform, process.getuid?.())) throw new Error('Protected account auth file required');
    const content = await file.readFile('utf8');
    const after = await lstat(path);
    if (!after.isFile() || after.isSymbolicLink() || after.ino !== opened.ino || after.dev !== opened.dev || !protectedFilePermissions(after.mode, after.uid, process.platform, process.getuid?.()) || Buffer.byteLength(content) > maximumBytes)
      throw new Error('Account protected file changed during read');
    return content;
  } finally { await file.close(); }
}