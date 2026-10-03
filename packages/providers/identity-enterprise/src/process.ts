/** Explicit per-member process composition; no local identity fallback. */
import {Service,type Context} from '@deepseek-ai/cordis';
import {readFile,lstat} from 'node:fs/promises';
import type {IdentityService,IdentityResolutionContext} from 'workdsh-contracts';
import {EnterpriseMemberIdentity} from './member-identity.js';
import {enterpriseBackendMemberVerifier} from './backend-authentication.js';
export interface EnterpriseProcessConfig {backendUrl:string;authFile:string;principalId:string;organizationId:string}
export async function authenticateProcessLogin(config:EnterpriseProcessConfig,signal?:AbortSignal){
  const s=await lstat(config.authFile);
  if(!s.isFile()||(s.mode&0o077)!==0)throw new Error('Protected enterprise process login required');
  const content=await readFile(config.authFile,'utf8');
  if(content.length>65536)throw new Error('Enterprise login invalid');
  const cookies:unknown=content.startsWith('[')?JSON.parse(content):[content];
  if(!Array.isArray(cookies)||cookies.length>64||cookies.some(v=>typeof v!=='string'||v.length>8192))throw new Error('Enterprise login invalid');
  for(const cookie of cookies){
   let identity:EnterpriseMemberIdentity;
   try{identity=await EnterpriseMemberIdentity.admit(enterpriseBackendMemberVerifier(config.backendUrl,{headers:{cookie}}),signal);}
   catch{signal?.throwIfAborted();continue;}
   const p=identity.profile();
   if(p.principalId!==config.principalId||p.organization.id!==config.organizationId){throw new Error('Enterprise process member mismatch');}
   return {identity,cookie};
  }
  throw new Error('Enterprise authentication required');
 }

export default class EnterpriseProcessIdentity extends Service implements IdentityService {
 readonly id='workdsh-enterprise-process';
 private identity?:EnterpriseMemberIdentity;
 constructor(ctx:Context,private readonly config:EnterpriseProcessConfig){super(ctx,'workdshIdentity');}
 private async authenticate(signal?:AbortSignal){
  try{const {identity}=await authenticateProcessLogin(this.config,signal);this.identity=identity;return identity;}
  catch(error){this.identity=undefined;throw error;}
 }
 async [Service.init](){await this.authenticate();}
 profile(){if(!this.identity)throw new Error('Enterprise authentication required');return this.identity.profile();}
 membership(organizationId:string,principalId:string){return this.identity?.membership(organizationId,principalId);}
 async resolve(evidence?:IdentityResolutionContext,signal?:AbortSignal){const i=await this.authenticate(signal);return i.resolve(evidence,signal);}
}
