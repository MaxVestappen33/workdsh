import type {Context} from '@deepseek-ai/cordis';
import type {ToolRunContext} from '@deepseek-ai/dsh-tools';
export interface OfflinePackageRegistration {readonly directory:string;readonly manifestSha256:string}
export interface OfflineComputeProvenance {
 readonly package:{readonly id:string;readonly version:string;readonly manifestSha256:string};
 readonly dependencyLockSha256:string;
 /** Interpreter executable digest, explicitly not the full runtime payload digest. */
 readonly interpreterSha256:string;
 readonly platform:string;
 readonly architecture:string;
 readonly environment:'ephemeral-offline-venv'|'ephemeral-pure-python-with-verified-host-numpy';
 readonly hostDependency?:{name:string;version:string;contentSha256:string;teamId:string};
}
/** Trusted installed package registration only; not a model/client file-path API.
 * Domain must authorize task/data before calling. Uses caller's official scope.
 */
export function executeOfflineOperation(ctx:Context,exec:ToolRunContext,registration:OfflinePackageRegistration,input:{operation:string;[key:string]:unknown}):Promise<{output:unknown;provenance:OfflineComputeProvenance}>;
