import {createHash} from 'node:crypto';
import {defineDomain,type Domain,type DomainFacility} from '@deepseek-ai/dsh-storage-domain';
import {z} from 'zod';
import {assertActorContext,type ActorContext,type IdentityService} from 'workdsh-contracts';

function spec(actor:ActorContext){
  const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId])).digest('hex').slice(0,40);
  return defineDomain({name:`workdsh_shortcuts_${key}`,version:1,global:{schema:z.object({organizationId:z.string(),principalId:z.string(),ids:z.array(z.string().min(1).max(128)).max(8)}),initial:{organizationId:actor.organizationId,principalId:actor.principalId,ids:[] as string[]}},tables:{}});
}
/** Local Profile preferences, owned by the resolved account. A pin is navigation
 * intent only; live verified Client registration remains required to show it. */
export class WorkbenchShortcutsService{
  private closed=false;
  private stores=new Map<string,Promise<{domain:Domain<ReturnType<typeof spec>>;serial:Promise<unknown>}>>();
  constructor(private storage:DomainFacility,private identity:IdentityService,private available:(id:string)=>boolean){}
  private check(actor:ActorContext,signal?:AbortSignal){
    signal?.throwIfAborted();if(this.closed)throw Error('workbench/shortcuts-closed');
    const current=this.identity.profile();
    if(current.principalId!==actor.principalId||current.organization.id!==actor.organizationId||current.resolvedBy!==actor.resolvedBy||this.identity.membership(actor.organizationId,actor.principalId)?.state!=='active')throw Error('workbench/shortcuts-access-denied');
  }
  async invoke(id:string|undefined,pinned:boolean|undefined,signal?:AbortSignal){
    if(id!==undefined&&(typeof id!=='string'||!id.trim()||id.length>128||typeof pinned!=='boolean'))throw Error('workbench/invalid-shortcut');
    const actor=await this.identity.resolve(undefined,signal);assertActorContext(actor);this.check(actor,signal);
    const key=JSON.stringify([actor.organizationId,actor.principalId]);let pending=this.stores.get(key);
    if(!pending){pending=this.storage.open(spec(actor)).then(domain=>({domain,serial:Promise.resolve()}));this.stores.set(key,pending);pending.catch(()=>{if(this.stores.get(key)===pending)this.stores.delete(key);});}
    const store=await pending;this.check(actor,signal);
    const run=store.serial.then(async()=>{
      this.check(actor,signal);const saved=store.domain.global.get();
      if(saved.organizationId!==actor.organizationId||saved.principalId!==actor.principalId)throw Error('workbench/shortcuts-access-denied');
      let ids=[...saved.ids];
      if(id!==undefined){
        if(pinned&&!this.available(id))throw Error('workbench/shortcut-unavailable');
        if(pinned&&!ids.includes(id)){if(ids.length>=8)throw Error('workbench/shortcuts-limit');ids.push(id);}
        if(!pinned)ids=ids.filter(item=>item!==id);
        this.check(actor,signal);await store.domain.global.set({organizationId:actor.organizationId,principalId:actor.principalId,ids});this.check(actor,signal);
      }
      return {organizationId:actor.organizationId,principalId:actor.principalId,ids};
    });
    store.serial=run.catch(()=>undefined);return run;
  }
  async close(){this.closed=true;await Promise.allSettled([...this.stores.values()].map(async pending=>{const store=await pending;await store.serial;await store.domain.close();}));this.stores.clear();}
}
