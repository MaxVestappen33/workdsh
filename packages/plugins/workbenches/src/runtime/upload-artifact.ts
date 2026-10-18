import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverWorkbenchPackageArtifact } from './package-artifact.js';
import { retainWorkbenchArtifact } from './retain-artifact.js';

/** Binary upload staging. Root and authorization come from the Host. No client
 * filename/path is used; success retains bytes without installation authority. */
export async function receiveWorkbenchArtifact(root: string, body: ReadableStream<Uint8Array>,
  expected: { packageName: string; version: string; workbenchId: string } | undefined, authorize: () => void, signal?: AbortSignal) {
  const captured = expected && { ...expected };
  const check = () => { signal?.throwIfAborted(); authorize(); };
  check();
  const directory = join(await realpath(root), '.workdsh-workbench-uploads');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== directory) throw new Error('workbench/archive-directory-outside');
  check();
  const path = join(directory, `${randomUUID()}.tgz`);
  const file = await open(path, 'wx', 0o600);
  const reader = body.getReader(), hash = createHash('sha256');
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  let length = 0, completed = false;
  try {
    while (true) {
      check();
      const item = await reader.read(); check();
      if (item.done) break;
      if (!(item.value instanceof Uint8Array)) throw new Error('workbench/invalid-upload');
      length += item.value.byteLength;
      if (length > 8 * 1024 * 1024) throw new Error('workbench/package-archive-size-limit');
      hash.update(item.value); await file.writeFile(item.value);
    }
    if (!length) throw new Error('workbench/invalid-upload');
    await file.sync(); await file.close(); check();
    const observed = await discoverWorkbenchPackageArtifact(path, signal);
    check();
    if (captured && (observed.receipt.packageName !== captured.packageName || observed.receipt.version !== captured.version || observed.manifest.descriptor.id !== captured.workbenchId)) throw new Error('workbench/package-identity-mismatch');
    const facts = { ...observed.receipt, workbenchId: observed.manifest.descriptor.id, sha256: hash.digest('hex') };
    if (facts.sha256 !== observed.receipt.sha256) throw new Error('workbench/package-hash-mismatch');
    const retainedPath = await retainWorkbenchArtifact(root, path, facts, signal);
    check(); completed = true;
    return Object.freeze({ expected: Object.freeze(facts), path: retainedPath });
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await file.close().catch(() => undefined);
    await rm(path, { force: true });
  }
}
