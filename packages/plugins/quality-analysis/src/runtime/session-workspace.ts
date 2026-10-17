import {createHash} from 'node:crypto';
import {mkdir,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import type {Context} from '@deepseek-ai/cordis';
import type {SessionCreateRequest} from '@deepseek-ai/dsh-api-session-controller/types';
import type {ActorContext} from 'workdsh-contracts';

type WorkspaceId=NonNullable<SessionCreateRequest['workspaceId']>;
type SessionId=NonNullable<SessionCreateRequest['sessionId']>;
/** Structural ports for the published Workspace Controller and Workspace
 * consumer interfaces. Their registry remains the only membership owner. */
export interface QualityNativeWorkspace {
 readonly id:WorkspaceId;
 readonly path:string;
 readonly sessionIds:readonly SessionId[];
 setTitle(title:string):Promise<void>;
 attachSession(sessionId:SessionId):Promise<void>;
}
export interface QualityWorkspacePorts {
 controller:{create(request:{path:string}):Promise<{workspace:{workspaceId:WorkspaceId;path:string};created:boolean}>};
 registry:{get(id:WorkspaceId):QualityNativeWorkspace|undefined};
}
export function qualityWorkspacePorts(ctx:Context):QualityWorkspacePorts {
 const controller=ctx.get('workspaceController') as QualityWorkspacePorts['controller']|undefined;
 const registry=ctx.get('workspaceRegistry') as QualityWorkspacePorts['registry']|undefined;
 if(!controller||!registry)throw Error('quality/service/session-unavailable');
 return {controller,registry};
}

/** Adopt only a Host-authored path; never accept a directory from the browser
 * or model. Existing paths retain their presentation and native identity. */
export async function registerQualityWorkspace(ports:QualityWorkspacePorts,path:string,authorize:()=>void){
 authorize();if(!isAbsolute(path))throw Error('quality/service/workspace-conflict');
 const receipt=await ports.controller.create({path});authorize();
 const workspace=ports.registry.get(receipt.workspace.workspaceId);
 if(!workspace||workspace.path!==receipt.workspace.path)throw Error('quality/service/workspace-conflict');
 if(receipt.created){await workspace.setTitle('质量分析');authorize();}
 return workspace;
}

/** Each actor and analysis record gets one bounded working directory. This
 * changes no filesystem grant or Agent policy, and never copies source files. */
export async function createQualityWorkspace(ports:QualityWorkspacePorts,actor:ActorContext,recordId:string,
 authorize:()=>void,workspaceRoot?:string){
 authorize();
 const configured=workspaceRoot??process.env.DSH_HOME??join(homedir(),'.workdsh');
 if(!isAbsolute(configured))throw Error('quality/service/workspace-conflict');
 await mkdir(configured,{recursive:true,mode:0o700});authorize();
 const root=await realpath(configured);authorize();
 const scope=join(root,'workdsh-quality-analysis');
 await mkdir(scope,{recursive:true,mode:0o700});authorize();
 if(await realpath(scope)!==scope)throw Error('quality/service/workspace-conflict');authorize();
 const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId,recordId])).digest('hex');
 const path=join(scope,key);
 await mkdir(path,{recursive:true,mode:0o700});authorize();
 if(await realpath(path)!==path)throw Error('quality/service/workspace-conflict');authorize();
 return registerQualityWorkspace(ports,path,authorize);
}

export async function attachQualitySession(workspace:QualityNativeWorkspace,sessionId:SessionId,authorize:()=>void){
 authorize();await workspace.attachSession(sessionId);authorize();
 if(!workspace.sessionIds.includes(sessionId))throw Error('quality/service/workspace-conflict');
}
