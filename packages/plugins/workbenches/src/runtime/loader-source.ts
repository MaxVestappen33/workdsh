/** Minimal public Loader boundary; no private tree or runtime fields are inspected. */
export interface WorkbenchLoader {
  locate(fiber: object): string | undefined;
  resolve(id: string): { readonly options: { readonly name: string }; readonly disabled: boolean };
}
export interface WorkbenchCallerContext { readonly fiber: { assertActive(): void } }
export interface WorkbenchLoaderSource { readonly entryId: string; readonly moduleName: string; readonly packageName: string }

/** Called by a Host lifecycle adapter with its actual Cordis caller context, never RPC data. */
export function resolveWorkbenchLoaderSource(loader: WorkbenchLoader, caller: WorkbenchCallerContext): WorkbenchLoaderSource {
  try { caller.fiber.assertActive(); } catch { throw new Error('workbench/inactive-caller'); }
  const entryId = loader.locate(caller.fiber);
  if (!entryId) throw new Error('workbench/unverified-caller');
  const entry = loader.resolve(entryId);
  if (entry.disabled) throw new Error('workbench/package-disabled');
  const moduleName = entry.options.name;
  // File paths, URLs and aliases require a separately verified adapter; never infer their owner.
  const match = /^(?:(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)|([a-z0-9][a-z0-9._-]*))(?:\/[a-z0-9._/-]+)?$/.exec(moduleName);
  if (!match || moduleName.split('/').some(segment => segment === '..' || segment === '.')) throw new Error('workbench/unverified-module-source');
  return Object.freeze({ entryId, moduleName, packageName: match[1] ?? match[2]! });
}
