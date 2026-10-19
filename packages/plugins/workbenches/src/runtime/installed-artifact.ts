import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { inspectWorkbenchPackageArtifact } from './package-artifact.js';

function contained(root: string, path: string) {
  const delta = relative(root, path);
  return delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
}

/** Host-only comparison with a retained verified archive. Inputs must come from
 * the installation owner. This proves observed package files, not executed
 * module identity, dependency closure, or future immutability. */
export async function verifyInstalledWorkbenchArtifact(installationRoot: string, archivePath: string,
  expected: { packageName: string; version: string; workbenchId: string; sha256: string }, signal?: AbortSignal) {
  const artifact = await inspectWorkbenchPackageArtifact(archivePath, { ...expected }, signal);
  const root = await realpath(installationRoot);
  const link = join(root, 'node_modules', artifact.receipt.packageName);
  const packageRoot = await realpath(link);
  if (!contained(root, packageRoot)) throw new Error('workbench/package-path-outside-installation');
  for (const name of artifact.files) {
    signal?.throwIfAborted();
    const path = await realpath(join(packageRoot, name));
    if (!contained(packageRoot, path)) throw new Error('workbench/installed-file-outside-package');
    const digest = artifact.fileDigests[name]!;
    const file = await open(path, 'r');
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size !== digest.bytes) throw new Error('workbench/installed-file-mismatch');
      const hash = createHash('sha256'), bytes = Buffer.alloc(64 * 1024);
      let length = 0;
      while (length <= digest.bytes) {
        signal?.throwIfAborted();
        const result = await file.read(bytes, 0, Math.min(bytes.length, digest.bytes - length + 1), length);
        if (!result.bytesRead) break;
        length += result.bytesRead; hash.update(bytes.subarray(0,result.bytesRead));
      }
      const after = await file.stat();
      const current = await stat(path);
      if (length !== digest.bytes || hash.digest('hex') !== digest.sha256 || before.mtimeMs !== after.mtimeMs
        || before.size !== after.size || before.ino !== current.ino || before.dev !== current.dev || before.size !== current.size || before.mtimeMs !== current.mtimeMs || await realpath(join(packageRoot,name)) !== path) throw new Error('workbench/installed-file-mismatch');
    } finally { await file.close(); }
  }
  signal?.throwIfAborted();
  if (await realpath(link) !== packageRoot) throw new Error('workbench/installation-changed');
  return artifact;
}
