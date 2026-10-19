/** Resolve a member-owned association before changing package selection.
 * A cancelled lookup must never continue into a mutation. */
export async function resolveActivationAssociation(
  packageName: string, workbenchId: string,
  listDevelopments: (signal: AbortSignal) => Promise<readonly { development: { id: string; packageName: string; workbenchId: string } }[]>,
  listImports: (signal: AbortSignal) => Promise<readonly { importId: string; packageName: string; workbenchId: string }[]>,
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted();
  const records = await listDevelopments(signal);
  signal.throwIfAborted();
  const record = records.find(row => row.development.packageName === packageName && row.development.workbenchId === workbenchId);
  if (record) return record.development.id;
  const imports = await listImports(signal);
  signal.throwIfAborted();
  return imports.find(row => row.packageName === packageName && row.workbenchId === workbenchId)?.importId;
}
