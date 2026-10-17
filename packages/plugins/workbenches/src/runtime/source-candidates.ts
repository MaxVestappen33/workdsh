import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, opendir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

/** Only scans the Host-owned source directory; filenames never become paths from RPC. */
export async function readWorkbenchSourceCandidates<T>(directory: string,
  inspect: (name: string, bytes: Uint8Array) => Promise<T>, check: () => void) {
  check();
  if (await realpath(directory) !== directory) throw new Error('workbench/source-directory-outside');
  const rows: { fileName: string; sha256?: string; candidate?: T; errorCode?: string }[] = [];
  let count = 0;
  for await (const entry of await opendir(directory)) {
    check();
    if (++count > 256) throw new Error('workbench/source-directory-size-limit');
    if (!entry.isFile() || !/^[a-zA-Z0-9._-]{1,214}\.tgz$/.test(entry.name)) continue;
    if (rows.length >= 12) throw new Error('workbench/candidate-count-limit');
    let sha256: string | undefined;
    try {
      const file = await open(join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Uint8Array;
      try {
        const before = await file.stat();
        if (!before.isFile() || !before.size || before.size > 8 * 1024 * 1024) throw new Error('workbench/package-archive-size-limit');
        const buffer = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < buffer.length) { check(); const read = await file.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
        const after = await file.stat();
        if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('workbench/source-revision-conflict');
        bytes = buffer.subarray(0, length);
      } finally { await file.close(); }
      sha256 = createHash('sha256').update(bytes).digest('hex');
      check(); const candidate = await inspect(entry.name, bytes); check();
      rows.push({ fileName: entry.name, sha256, candidate });
    } catch (cause) {
      check();
      rows.push({ fileName: entry.name, ...(sha256 ? { sha256 } : {}), errorCode: cause instanceof Error && /^workbench\/[a-z-]+$/.test(cause.message) ? cause.message : 'workbench/package-preview-failed' });
    }
  }
  check(); return rows;
}
