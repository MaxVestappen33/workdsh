/** Managed domain computation v1. Contract only; no executor or environment implementation. */
import type {ActorContext} from './governance.js';

export type ComputeJson=null|boolean|number|string|readonly ComputeJson[]|{readonly [key:string]:ComputeJson};
export interface ComputePackageRef{
 readonly id:string;
 readonly version:string;
 readonly manifestSha256:string;
}
export interface ComputeEnvironmentRef{
 readonly id:string;
 readonly package:ComputePackageRef;
 readonly runtimeDigest:string;
 readonly dependencyLockSha256:string;
 readonly platform:string;
 readonly architecture:string;
}
export type ComputePreparation={
 readonly status:'ready';readonly environment:ComputeEnvironmentRef;
}|{
 readonly status:'unavailable';readonly reason:'unsupported_platform'|'runtime_unavailable'|'dependency_unavailable'|'preparation_failed';
};
export interface ComputeRequest{
 readonly requestId:string;
 readonly sessionId:string;
 readonly task:{readonly domain:string;readonly id:string;readonly revision:string};
 readonly environment:ComputeEnvironmentRef;
 /** A fixed operation declared by the trusted package manifest; never a shell command/path. */
 readonly operation:string;
 readonly input:ComputeJson;
}
export type ComputeOutcome={
 readonly status:'succeeded';readonly requestId:string;readonly environment:ComputeEnvironmentRef;
 readonly output:ComputeJson;
}|{
 readonly status:'failed'|'cancelled'|'timed_out';readonly requestId:string;
 readonly code:string;
};
/** Trusted same-process Host API; actor resolved by IdentityService, not model/client fields.
 * Providers must re-authorize prepare/run, bind jobs to session/task, verify locked
 * artifacts, isolate professional dependencies from the official shared environment,
 * route operations through the supported Host execution boundary, and drain on disposal.
 * Preparation is explicit and must not silently upgrade environments retained by old runs.
 */
export interface ManagedComputeService{
 readonly contractVersion:1;
 prepare(actor:ActorContext,packageRef:ComputePackageRef,signal:AbortSignal):Promise<ComputePreparation>;
 run(actor:ActorContext,request:ComputeRequest,signal:AbortSignal):Promise<ComputeOutcome>;
 /** Inspect retained environment availability without installing or substituting a version. */
 inspect(actor:ActorContext,environment:ComputeEnvironmentRef,signal:AbortSignal):Promise<'ready'|'unavailable'>;
}
