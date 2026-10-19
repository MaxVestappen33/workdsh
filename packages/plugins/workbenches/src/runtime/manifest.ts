import { parseWorkbenchDescriptor, type WorkbenchDescriptor } from 'workdsh-contracts';

export interface InstalledWorkbenchManifest {
  readonly packageName: string;
  readonly version: string;
  readonly descriptor: WorkbenchDescriptor;
}

/** Parse metadata read by the Host from the official resolved installation, without importing code. */
export function parseInstalledWorkbenchManifest(value: unknown, expectedPackageName: string): InstalledWorkbenchManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('workbench/invalid-manifest');
  const manifest = value as Record<string, unknown>;
  if (manifest.name !== expectedPackageName) throw new Error('workbench/package-name-mismatch');
  const namespace = manifest.workdsh;
  if (namespace === undefined) return undefined;
  if (!namespace || typeof namespace !== 'object' || Array.isArray(namespace)) throw new Error('workbench/invalid-manifest');
  const declaration = (namespace as Record<string, unknown>).workbench;
  if (declaration === undefined) return undefined;
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) throw new Error('workbench/invalid-manifest');
  if (Array.isArray(declaration)) throw new Error('workbench/one-workbench-per-package');
  return Object.freeze({ packageName: expectedPackageName, version: manifest.version, descriptor: parseWorkbenchDescriptor(declaration) });
}
