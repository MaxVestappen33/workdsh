import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { setImmediate } from 'node:timers/promises';
import type { WorkbenchPackageReceipt } from 'workdsh-contracts';
import { parseInstalledWorkbenchManifest, type InstalledWorkbenchManifest } from './manifest.js';
const MAX_ARCHIVE = 8 * 1024 * 1024, MAX_EXPANDED = 64 * 1024 * 1024, MAX_FILE = 16 * 1024 * 1024, MAX_MANIFEST = 256 * 1024;
export interface WorkbenchPackageArtifact {
  readonly receipt: WorkbenchPackageReceipt;
  readonly manifest: InstalledWorkbenchManifest;
  readonly packageMetadata: Readonly<Record<string, unknown>>;
  readonly files: readonly string[];
  readonly fileDigests: Readonly<Record<string, { readonly sha256: string; readonly bytes: number }>>;
  readonly archiveBytes: number;
  readonly expandedBytes: number;
  /** Bounded scripts from the same verified archive, for non-executing checks. */
  readonly scripts?: Readonly<Record<string, string>>;
}
function fail(code = 'invalid-package-archive'): never { throw new Error(`workbench/${code}`); }
function field(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(end < 0 ? bytes : bytes.subarray(0, end)); }
  catch { return fail(); }
}
function octal(bytes: Buffer): number {
  const text = field(bytes).trim();
  if (!/^[0-7]+$/.test(text)) return fail();
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) return fail();
  return value;
}
async function expand(bytes: Buffer, signal?: AbortSignal) {
  const gzip = createGunzip(), chunks: Buffer[] = [];
  let length = 0;
  const onAbort = () => gzip.destroy(new Error('workbench/request-cancelled'));
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    Readable.from([bytes]).pipe(gzip);
    for await (const chunk of gzip) {
      signal?.throwIfAborted();
      length += chunk.length;
      if (length > MAX_EXPANDED) return fail('package-expanded-size-limit');
      chunks.push(chunk);
    }
    signal?.throwIfAborted();
    return Buffer.concat(chunks, length);
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause instanceof Error && cause.message.startsWith('workbench/')) throw cause;
    return fail();
  } finally { signal?.removeEventListener('abort', onAbort); gzip.destroy(); }
}

/** Host-only staged-artifact inspection. Path must be authorized by the Host.
 * Reads/hash-checks the actual bounded bytes without extracting or executing code.
 * Accepts regular-file/directory ustar npm archives; links and extension records
 * are rejected explicitly. Dependency closure and installed runtime are separate gates.
 */
type ExpectedArtifact = { packageName: string; version: string; workbenchId: string; sha256?: string };
export async function inspectWorkbenchPackageArtifact(path: string, expected: ExpectedArtifact, signal?: AbortSignal): Promise<WorkbenchPackageArtifact> {
  return inspectArtifact(path, { ...expected }, signal);
}
/** Discover bounded static metadata for first import. This is not installation
 * authority; subsequent operations must use the derived identity and hash. */
export async function discoverWorkbenchPackageArtifact(path: string, signal?: AbortSignal): Promise<WorkbenchPackageArtifact> {
  return inspectArtifact(path, undefined, signal);
}
async function inspectArtifact(path: string, expected: ExpectedArtifact | undefined, signal?: AbortSignal): Promise<WorkbenchPackageArtifact> {
  signal?.throwIfAborted();
  const file = await open(path, 'r');
  let bytes: Buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return fail();
    if (stat.size > MAX_ARCHIVE) return fail('package-archive-size-limit');
    const buffer = Buffer.alloc(MAX_ARCHIVE + 1); let length = 0;
    while (length < buffer.length) {
      signal?.throwIfAborted();
      const read = await file.read(buffer, length, Math.min(64 * 1024, buffer.length - length), length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > MAX_ARCHIVE) return fail('package-archive-size-limit');
    bytes = buffer.subarray(0, length);
  } finally { await file.close(); }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expected?.sha256 !== undefined && expected.sha256 !== sha256) return fail('package-hash-mismatch');
  const tar = await expand(bytes, signal);
  const files: string[] = [], paths = new Set<string>();
  const scripts: Record<string, string> = Object.create(null);
  const fileDigests: Record<string, { readonly sha256: string; readonly bytes: number }> = Object.create(null);
  let manifestBytes: Buffer | undefined, offset = 0, count = 0, ended = false;
  while (offset + 512 <= tar.length) {
    signal?.throwIfAborted();
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (offset + 1024 > tar.length || !tar.subarray(offset).every(byte => byte === 0)) return fail();
      ended = true; break;
    }
    if (++count > 4096) return fail('package-entry-count-limit');
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== octal(header.subarray(148, 156)) || field(header.subarray(257, 263)) !== 'ustar') return fail();
    const prefix = field(header.subarray(345, 500)), name = field(header.subarray(0, 100));
    const path = `${prefix ? prefix + '/' : ''}${name}`.replace(/\/$/, '');
    const parts = path.split('/');
    if (parts.some(part => part.startsWith('._'))) return fail('package-macos-metadata');
    if (parts[0] !== 'package' || parts.some(part => !part || part === '.' || part === '..') || /[\\:\u0000-\u001f]/.test(path)) return fail('package-invalid-path');
    if (paths.has(path)) return fail('package-duplicate-path');
    paths.add(path);
    const size = octal(header.subarray(124, 136)), type = header[156];
    if (type !== 0 && type !== 48 && type !== 53) return fail('package-unsupported-entry');
    if (type === 53 && size !== 0) return fail();
    if (size > MAX_FILE) return fail('package-entry-size-limit');
    const start = offset + 512, next = start + Math.ceil(size / 512) * 512;
    if (next > tar.length) return fail();
    if (type !== 53) {
      if (parts.length < 2) return fail('package-invalid-path');
      const relativePath = path.slice(8);
      files.push(relativePath);
      if (/\.(?:js|mjs|cjs)$/.test(relativePath)) scripts[relativePath] = new TextDecoder().decode(tar.subarray(start, start + size));
      fileDigests[relativePath] = Object.freeze({ sha256: createHash('sha256').update(tar.subarray(start,start+size)).digest('hex'), bytes: size });
      if (path === 'package/package.json') {
        if (size > MAX_MANIFEST) return fail('manifest-size-limit');
        manifestBytes = tar.subarray(start, start + size);
      }
    }
    offset = next;
    if (count % 128 === 0) await setImmediate(undefined, { signal });
  }
  if (!ended || !manifestBytes) return fail();
  let json: unknown;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); } catch { return fail('invalid-manifest'); }
  const declaredName = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>).name : undefined;
  if (typeof declaredName !== 'string' || declaredName.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(declaredName)) return fail('package-identity-mismatch');
  const manifest = parseInstalledWorkbenchManifest(json, expected?.packageName ?? declaredName);
  if (!manifest || (expected && (manifest.version !== expected.version || manifest.descriptor.id !== expected.workbenchId))) return fail('package-identity-mismatch');
  // Keep metadata tied to these inspected bytes; later gates must not accept
  // a second page-supplied manifest. Iterative freezing handles nested JSON safely.
  const pending: object[] = [json as object];
  while (pending.length) {
    const item = pending.pop()!;
    for (const value of Object.values(item)) if (value !== null && typeof value === 'object') pending.push(value);
    Object.freeze(item);
  }
  signal?.throwIfAborted();
  return Object.freeze({ packageMetadata: json as Readonly<Record<string, unknown>>, receipt: Object.freeze({ packageName: manifest.packageName, version: manifest.version, sha256 }), manifest, files: Object.freeze(files), fileDigests: Object.freeze(fileDigests), scripts: Object.freeze(scripts), archiveBytes: bytes.length, expandedBytes: tar.length });
}
