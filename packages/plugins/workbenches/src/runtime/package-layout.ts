import type { WorkbenchPackageArtifact } from './package-artifact.js';
import { checkWorkbenchToolSchemas } from './tool-schema-preflight.js';
export interface WorkbenchPackageLayout {
  readonly host: string;
  readonly hostTypes: string;
  readonly client: string;
  readonly clientTypes: string;
  readonly patch: string;
  /** Declared dependencies needing actual closure/install validation in the next gate. */
  readonly runtimeDependencies: Readonly<Record<string, string>>;
}
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function fail(code: string): never { throw new Error(`workbench/${code}`); }

/** Checks packaged owned-template layout and locked Host references, without loading
 * code. Does not prove transitive dependency closure or actual runtime compatibility.
 */
export function validateWorkbenchPackageLayout(artifact: WorkbenchPackageArtifact, host: { harnessVersion: string; cordisVersion: string }): WorkbenchPackageLayout {
  const pkg = artifact.packageMetadata, files = new Set(artifact.files);
  const path = (target: unknown): string => {
    if (typeof target !== 'string' || !target.startsWith('./') || /[\\:\u0000-\u001f]/.test(target) || target.slice(2).split('/').some(part => !part || part === '.' || part === '..')) return fail('package-invalid-export');
    return target.slice(2);
  };
  const present = (target: unknown): string => {
    const name = path(target);
    if (!files.has(name)) return fail('package-missing-export');
    return name;
  };
  const allExports = (value: unknown, depth = 0): void => {
    if (depth > 32) return fail('package-invalid-export');
    if (value === null) return; // Standard export maps may explicitly deny a subpath.
    if (typeof value === 'string') {
      const pattern = path(value);
      if (pattern.includes('*')) {
        const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        if (![...files].some(name => new RegExp(`^${escaped}$`).test(name))) return fail('package-missing-export');
      } else present(value);
      return;
    }
    if (Array.isArray(value)) { if (!value.length) return fail('package-invalid-export'); for (const item of value) allExports(item, depth + 1); return; }
    const condition = object(value);
    if (!condition || !Object.keys(condition).length) return fail('package-invalid-export');
    for (const item of Object.values(condition)) allExports(item, depth + 1);
  };
  if (pkg.type !== 'module') return fail('package-unsupported-module-format');
  const exports = object(pkg.exports), root = object(exports?.['.']), client = object(exports?.['./client']);
  if (!exports || !root || !client) return fail('package-missing-entry');
  allExports(exports);
  const dsh = object(pkg.dsh), bundle = object(dsh?.bundle), clientMetadata = object(dsh?.client);
  if (!bundle || clientMetadata?.platform !== 'web') return fail('package-missing-dsh-metadata');
  const runtimeDependencies: Record<string, string> = {};
  for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    if (pkg[key] === undefined) continue;
    const dependencies = object(pkg[key]);
    if (!dependencies) return fail('package-invalid-dependencies');
    for (const [name, value] of Object.entries(dependencies)) {
      if (typeof value !== 'string' || !value.trim() || value.length > 256) return fail('package-invalid-dependencies');
      if (/^(?:workspace:|link:)/.test(value)) return fail('package-unresolved-workspace-dependency');
      if ((name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) && value !== host.harnessVersion) return fail('package-kernel-version-mismatch');
      if (name === '@deepseek-ai/cordis' && value !== host.cordisVersion) return fail('package-cordis-version-mismatch');
      if (runtimeDependencies[name] !== undefined && runtimeDependencies[name] !== value) return fail('package-dependency-version-conflict');
      runtimeDependencies[name] = value;
    }
  }
  const layout = { host: present(root.default), hostTypes: present(root.types), client: present(client.default), clientTypes: present(client.types), patch: present(bundle.patch), runtimeDependencies: Object.freeze(runtimeDependencies) };
  checkWorkbenchToolSchemas(artifact.scripts ?? {});
  return Object.freeze(layout);
}
