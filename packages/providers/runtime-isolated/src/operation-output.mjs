/** Recover only the complete stdout artifact returned by the official bash
 * invocation. Keep the provider filesystem, bounded reads and cancellation.
 * Never interpret opaque filesystem identities or read model-supplied paths.
 */
const MAX_OUTPUT_BYTES = 9 * 1024 * 1024;
export async function recoverOperationOutput(ctx, exec, value) {
 if(value?.kind !== 'foreground' || value.exitCode !== 0 || value.aborted || value.timedOut || value.signal || value.sandbox?.denied || value.sandbox?.runnerFailed || !value.stdout?.truncated) return value;
 const path=value.stdout.spillPath;
 if(typeof path !== 'string' || !path || !ctx.fs) throw Error('HOST_COMPUTE_OPERATION_TRUNCATED');
 exec.signal.throwIfAborted();
 const target=await ctx.fs.resolve(path,{signal:exec.signal});
 const info=await ctx.fs.stat(target,exec.signal);
 if(info?.type !== 'file') throw Error('HOST_COMPUTE_OPERATION_SPILL_INVALID');
 if(info.size > MAX_OUTPUT_BYTES) throw Error('HOST_COMPUTE_OPERATION_RESULT_SIZE_LIMIT');
 const bytes=await ctx.fs.readBytes(target,exec.signal,MAX_OUTPUT_BYTES);
 exec.signal.throwIfAborted();
 if(bytes.byteLength > MAX_OUTPUT_BYTES) throw Error('HOST_COMPUTE_OPERATION_RESULT_SIZE_LIMIT');
 const after=await ctx.fs.stat(target,exec.signal);
 if(!after || after.version !== info.version) throw Error('HOST_COMPUTE_OPERATION_SPILL_CHANGED');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 return {...value,stdout:{...value.stdout,text,truncated:false}};
}
