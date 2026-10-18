export function patchNativeWorkbenchFrame(source: string): string
export function ensureNativeWorkbenchFrame(profile: string, options?: { rollback?: boolean }): Promise<void>
export function verifyNativeWorkbenchFrame(profile: string): Promise<{
 package: string; version: string; file: string; sha256: string
}>
