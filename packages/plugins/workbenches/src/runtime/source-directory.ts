import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs';
import type { WorkbenchDevelopment } from 'workdsh-contracts';
/** Authorizes actual provider targets, independently of UI paths or Profile selection. */
export type AuthorizeWorkbenchSourceRead = (target: FsTarget, signal?: AbortSignal) => Promise<void>;
/** Verify directory/package identity only. This does NOT manufacture a source revision
 * or back up files; the snapshot owner must do that before bindVerifiedSource. */
export async function verifyWorkbenchSourceDirectory(fs: Pick<FileSystem,'resolve'|'stat'|'readBytes'|'contains'|'processPath'>,
  directory: string, development: WorkbenchDevelopment, authorize: AuthorizeWorkbenchSourceRead, signal?: AbortSignal): Promise<string> {
  const expected = { packageName: development.packageName, workbenchId: development.workbenchId };
  signal?.throwIfAborted();
  const root = await fs.resolve(directory,{signal});
  await authorize(root,signal);signal?.throwIfAborted();
  if ((await fs.stat(root,signal))?.type !== 'directory') throw new Error('workbench/source-directory-missing');
  const metadata = await fs.resolve('package.json',{cwd:fs.processPath(root),signal});
  if (!fs.contains(root,metadata)) throw new Error('workbench/source-metadata-outside');
  await authorize(metadata,signal);signal?.throwIfAborted();
  const before = await fs.stat(metadata,signal);
  if (before?.type !== 'file') throw new Error('workbench/source-package-missing');
  const bytes = await fs.readBytes(metadata,signal,256*1024);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new Error('workbench/source-package-invalid'); }
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  const workdsh = record?.workdsh && typeof record.workdsh === 'object' ? record.workdsh as Record<string, unknown> : undefined;
  const workbench = workdsh?.workbench && typeof workdsh.workbench === 'object' ? workdsh.workbench as Record<string, unknown> : undefined;
  if (record?.name !== expected.packageName || workbench?.id !== expected.workbenchId) throw new Error('workbench/source-identity-mismatch');
  const after = await fs.stat(metadata,signal);
  if (!after || before.version !== after.version) throw new Error('workbench/source-changed');
  const current = await fs.resolve(directory,{signal});
  if (current.targetKey !== root.targetKey) throw new Error('workbench/source-changed');
  await authorize(root,signal);await authorize(metadata,signal);signal?.throwIfAborted();
  // Authorization can await external state; recheck the same bytes and targets after it.
  const finalRoot = await fs.resolve(directory,{signal});
  const finalMetadata = await fs.resolve('package.json',{cwd:fs.processPath(finalRoot),signal});
  if (finalRoot.targetKey !== root.targetKey || finalMetadata.targetKey !== metadata.targetKey || !fs.contains(finalRoot,finalMetadata)) throw new Error('workbench/source-changed');
  const finalStat = await fs.stat(finalMetadata,signal);
  if (finalStat?.type !== 'file' || finalStat.version !== before.version) throw new Error('workbench/source-changed');
  const finalBytes = await fs.readBytes(finalMetadata,signal,256*1024);
  if (finalBytes.length !== bytes.length || finalBytes.some((byte,index) => byte !== bytes[index])) throw new Error('workbench/source-changed');
  signal?.throwIfAborted();
  return fs.processPath(finalRoot);
}
