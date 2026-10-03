/** Per-member native process: reuse the existing official persistence adapter.
 * Platform service keys remain in the root ingress, not in member processes. */
import type {Context} from '@deepseek-ai/cordis';
import {EnterpriseDatabaseSessions} from './database-sessions.js';
import {authenticateProcessLogin,type EnterpriseProcessConfig} from './process.js';
import {enterpriseBackendBearer} from './backend-authentication.js';
export interface EnterpriseProcessSessionsConfig extends EnterpriseProcessConfig {bridgeUrl:string}
export default class EnterpriseProcessSessions extends EnterpriseDatabaseSessions {
 constructor(ctx:Context,config:EnterpriseProcessSessionsConfig){
  const admitted=()=>authenticateProcessLogin(config);
  super(ctx,{backendUrl:config.bridgeUrl,serviceKey:'member-bridge-placeholder-not-a-platform-secret',
   authorization:async()=>enterpriseBackendBearer({headers:{cookie:(await admitted()).cookie}}),
   verify:async()=>{await admitted();},
  });
  this.installLiveRouting(ctx);
 }
}
