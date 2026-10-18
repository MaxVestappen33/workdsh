import type { WorkbenchPackageReceipt } from 'workdsh-contracts';

/** Persisted bundle selection does not prove the currently loaded version. */
export function confirmWorkbenchRuntimeSelection<T extends {
  packageName: string; version: string; selected: boolean; confirmed: boolean;
  pendingRestart: boolean; application: string;
}>(result: T, enabled: boolean, expectedHash: string,
  active: readonly { package: WorkbenchPackageReceipt }[]) {
  const matches = active.filter(row => row.package.packageName === result.packageName);
  const applied = enabled
    ? matches.length === 1 && matches[0].package.version === result.version && matches[0].package.sha256 === expectedHash
    : matches.length === 0;
  if (result.confirmed && !applied) return Object.freeze({ ...result,
    confirmed: false, pendingRestart: true, application: 'restart-required' });
  return result;
}
