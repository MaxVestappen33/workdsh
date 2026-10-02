import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domain from '@deepseek-ai/dsh-storage-domain';
import { AccessManager, SessionAccessBridge } from '../../packages/plugins/access/dist/index.js';
import { AuditJournal } from '../../packages/plugins/audit/dist/index.js';
import { ConnectorManager } from '../../packages/plugins/connectors/dist/index.js';

test('fixed-member connectors authorize native empty Sessions and deny foreign or revoked selections',async()=>{
 const root=await mkdtemp(join(tmpdir(),'member-connectors-'));const ctx=new Context();let foreignTouches=0;let active=true;
 const own={id:'a-session',ctx:{tools:{restrict(){return()=>{};}}}};
 const foreign={id:'b-session',get ctx(){foreignTouches++;throw Error('Foreign Agent touched');}};
 try {
  ctx.provide('tools',{schemas:()=>[]});ctx.provide('mcpResources',{});ctx.provide('credentials',{});
  ctx.provide('agents',{list:()=>[own,foreign],get:id=>id===own.id?own:foreign});
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(Domain,{backend:'json'});
  ctx.provide('workdshIdentity', {
   id:'workdsh-enterprise-process',
   profile:()=>({principalId:'a',organization:{id:'org',kind:'team'}}),
   membership:(organizationId,principalId)=>({organizationId,principalId,principalKind:'human',state:'active',role:'member',revision:'1'}),
   async resolve(evidence){if(!active)throw Error('member revoked');return {principalId:'a',organizationId:'org',requestId:'connector-read',resolvedBy:'workdsh-enterprise-process',sessionId:evidence?.sessionId};}
  });
  const reads=[];
  ctx.provide('sessionController',{async inspect(id){reads.push(id);if(!['a-session','new-session'].includes(id))throw Error('Session not found');return {meta:{id},events:[]};}});
  await ctx.plugin(AuditJournal);await ctx.plugin(AccessManager);
  await ctx.workdshAccess.bindSession({principalId:'b',organizationId:'org',requestId:'foreign-bind',resolvedBy:'test'},{sessionId:foreign.id});
  await ctx.plugin(SessionAccessBridge,{autoBindFixedMemberSessions:true});
  await ctx.plugin(ConnectorManager,{seedExample:false});
  assert.deepEqual(await ctx.workdshConnectors.list(),[]);
  assert.deepEqual(await ctx.workdshConnectors.setSelection(own.id,[]),[]);
  assert.deepEqual(await ctx.workdshConnectors.setSelection('new-session',[]),[]);
  assert.equal(ctx.workdshAccess.sessionOwner('new-session').ownerPrincipalId,'a');
  await assert.rejects(ctx.workdshConnectors.selection(foreign.id),/Session not found/);
  await assert.rejects(ctx.workdshConnectors.setSelection(foreign.id,[]),/Session not found/);
  active=false;await assert.rejects(ctx.workdshConnectors.selection(own.id),/member revoked/);
  await assert.rejects(ctx.workdshConnectors.setSelection(own.id,[]),/member revoked/);
  assert.ok(!reads.includes(foreign.id));
  assert.equal(foreignTouches,0);
 } finally {await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});

test('resource inspection without a selected Agent does not fabricate a tool caller',async()=>{
 const {default:Tools}=await import('@deepseek-ai/dsh-tools');
 const {default:McpResources}=await import('@deepseek-ai/dsh-mcp-resources');
 const {fileURLToPath}=await import('node:url');
 const root=await mkdtemp(join(tmpdir(),'mcp-resource-denial-'));const ctx=new Context();
 try{
  ctx.provide('systemPrompt',{tools(){},section(){},getSectionOrder(){return 0;}});
  ctx.provide('agents',{list:()=>[],get:()=>undefined});ctx.provide('credentials',{});
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root});await ctx.plugin(Domain,{backend:'json'});
  await ctx.plugin(Tools);await ctx.plugin(McpResources);
  let resourceProbes=0;ctx.on('tools/pre-execute',async(exec,next)=>{if(exec.name.startsWith('list_mcp_'))resourceProbes++;return next();});
  ctx.provide('workdshSessionAccess',{async inspect(){throw Error('No selected Session');}});
  await ctx.plugin(ConnectorManager,{seedExample:false});
  const row=await ctx.workdshConnectors.create({title:'Policy check',serverName:'policy-check',transport:'stdio',command:process.execPath,args:[fileURLToPath(new URL('../../scripts/fixtures/member-mcp-server.mjs',import.meta.url)),'policy-marker']});
  assert.equal(row.state,'ready');assert.ok(row.toolNames.length>0);assert.equal(row.resourceCount,0);assert.equal(row.diagnostic,'工具已连接，资源检查未完成。');assert.equal(resourceProbes,0);
 }finally{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
});
