/** Recover verified installed bytes before proposing another installation.
 * Only an explicit absent/different-version result permits preparation.
 * Offline/ambiguous/permission failures must never become install retries. */
export async function recoverWorkbenchCandidate<T>(verify:()=>Promise<unknown>,prepare:()=>Promise<T>,signal:AbortSignal){
 signal.throwIfAborted();
 try { await verify(); signal.throwIfAborted(); return {kind:'recovered' as const}; }
 catch(cause){
  signal.throwIfAborted();
  if(cause instanceof Error&&['TypeError','TimeoutError'].includes(cause.name))throw Error('workbench/native-installation-unconfirmed');
  if(!(cause instanceof Error)||!['workbench/native-installation-not-present','workbench/native-installation-version-different'].includes(cause.message))throw cause;
 }
 const prepared=await prepare();signal.throwIfAborted();return {kind:'prepared' as const,prepared};
}
