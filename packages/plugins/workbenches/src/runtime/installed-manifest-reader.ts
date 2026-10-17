import { open, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { parseInstalledWorkbenchManifest, type InstalledWorkbenchManifest } from './manifest.js';

const MAX_MANIFEST_BYTES = 256 * 1024;
function inside(root: string, path: string): boolean {
  const delta = relative(root, path);
  return delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
}

/** Host-only reader. The installation root must come from the Host adapter, never a page request. */
export class InstalledWorkbenchManifestReader {
  constructor(private readonly installationRoot: string) {}

  async read(packageName: string, signal?: AbortSignal): Promise<InstalledWorkbenchManifest | undefined> {
    signal?.throwIfAborted();
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName) || packageName.length > 214) throw new Error('workbench/invalid-package-name');
    const root = await realpath(this.installationRoot);
    const manifestPath = await realpath(join(root, 'node_modules', packageName, 'package.json'));
    if (!inside(root, manifestPath)) throw new Error('workbench/package-path-outside-installation');
    signal?.throwIfAborted();
    const file = await open(manifestPath, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('workbench/invalid-manifest-file');
      if (stat.size > MAX_MANIFEST_BYTES) throw new Error('workbench/manifest-size-limit');
      // Bound the read independently of stat: a concurrent writer cannot force an unbounded allocation.
      const bytes = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        signal?.throwIfAborted();
        const result = await file.read(bytes, length, bytes.length - length, length);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (length > MAX_MANIFEST_BYTES) throw new Error('workbench/manifest-size-limit');
      signal?.throwIfAborted();
      let manifest: unknown;
      try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))); }
      catch { throw new Error('workbench/invalid-manifest'); }
      return parseInstalledWorkbenchManifest(manifest, packageName);
    } finally { await file.close(); }
  }
}
