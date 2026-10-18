import { parseWorkbenchDescriptor, type WorkbenchDescriptor } from 'workdsh-contracts';
import type { WorkbenchRuntimeStatus } from '../runtime/runtime-observation.js';
export interface WorkbenchCatalogEntry {
  readonly packageName: string; readonly selected: boolean;
  readonly descriptor?: WorkbenchDescriptor; readonly version?: string;
  readonly compatible?: boolean; readonly registered?: boolean;
  readonly installed?: { readonly packageName: string; readonly version: string; readonly sha256: string };
  readonly missingResourceCatalogs?: readonly ('skill.select'|'expert.select'|'connector.invoke')[];
  readonly errorCode?: string;
  readonly runtimeStatus?: WorkbenchRuntimeStatus;
}
/** Validate independently observed selection, installed generation and Host
 * registration. No row itself establishes a Client page is available. */
export function createWorkbenchCatalogClient(transport: typeof fetch = fetch) {
  return async (signal?: AbortSignal): Promise<readonly WorkbenchCatalogEntry[]> => {
    const lifetime = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    const response = await transport('/api/workdsh-workbench-catalog', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: '{}', signal: lifetime });
    const result = await response.json(); lifetime.throwIfAborted();
    if (!response.ok || result?.ok !== true || !Array.isArray(result.value) || result.value.length > 1000) throw new Error('workbench/catalog-unavailable');
    const names = new Set<string>();
    return Object.freeze(result.value.map((row: any) => {
      if (!row || typeof row.packageName !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(row.packageName) ||
          names.has(row.packageName) || typeof row.selected !== 'boolean' ||
          (row.errorCode !== undefined && (typeof row.errorCode !== 'string' || !/^workbench\/[a-z-]+$/.test(row.errorCode)))) throw new Error('workbench/invalid-response');
      names.add(row.packageName);
      if (row.runtimeStatus !== undefined && !['unknown','loading','failed','active','unloading'].includes(row.runtimeStatus)) throw new Error('workbench/invalid-response');
      if (row.descriptor === undefined) {
        if (!row.errorCode || row.installed || row.registered) throw new Error('workbench/invalid-response');
        return Object.freeze({ packageName: row.packageName, selected: row.selected, errorCode: row.errorCode });
      }
      const descriptor = parseWorkbenchDescriptor(row.descriptor);
      const missing = row.missingResourceCatalogs ?? [];
      if (!Array.isArray(missing) || missing.length > 3 || new Set(missing).size !== missing.length || missing.some((item: unknown) => !['skill.select','expert.select','connector.invoke'].includes(item as string) || !descriptor.capabilities.some(capability => capability === item))) throw new Error('workbench/invalid-response');
      if (typeof row.version !== 'string' || !row.version || typeof row.compatible !== 'boolean' || typeof row.registered !== 'boolean') throw new Error('workbench/invalid-response');
      let installed;
      if (row.installed !== undefined) {
        if (row.installed.packageName !== row.packageName || row.installed.version !== row.version || typeof row.installed.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.installed.sha256)) throw new Error('workbench/invalid-response');
        installed = Object.freeze({ packageName: row.packageName, version: row.version, sha256: row.installed.sha256 });
      }
      if ((!installed && !row.errorCode) || (row.registered && (!installed || !row.selected || !row.compatible || row.errorCode))) throw new Error('workbench/invalid-response');
      return Object.freeze({ packageName: row.packageName, selected: row.selected, descriptor, version: row.version,
        compatible: row.compatible, registered: row.registered, installed, runtimeStatus: row.runtimeStatus, errorCode: row.errorCode, missingResourceCatalogs: Object.freeze([...missing]) });
    }));
  };
}
