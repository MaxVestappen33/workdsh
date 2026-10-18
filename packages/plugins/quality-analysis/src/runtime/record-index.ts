import {createHash,randomUUID} from 'node:crypto';
import {defineDomain,type Domain,type DomainFacility} from '@deepseek-ai/dsh-storage-domain';
import {z} from 'zod';
import {assertActorContext,type ActorContext} from 'workdsh-contracts';
const recordSchema=z.object({id:z.string(),title:z.string(),createdAt:z.string(),operationId:z.string()});
const stateSchema=z.object({organizationId:z.string(),principalId:z.string(),records:z.array(recordSchema)});
function spec(actor:ActorContext){const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId])).digest('hex').slice(0,40);
  return defineDomain({name:`workdsh_quality_index_${key}`,version:1,global:{schema:stateSchema,initial:{organizationId:actor.organizationId,principalId:actor.principalId,records:[]}},tables:{}});}
export class QualityRecordIndex {
  private serial:Promise<unknown>=Promise.resolve();private closing?:Promise<void>;
  private constructor(private readonly domain:Domain<ReturnType<typeof spec>>,private readonly actor:ActorContext){}
  static async open(storage:DomainFacility,actor:ActorContext){assertActorContext(actor);return new QualityRecordIndex(await storage.open(spec(actor)),{...actor});}
  list(){return structuredClone(this.state().records);}
  async create(title:string,operationId:string,authorizeBeforeWrite:()=>void,signal?:AbortSignal){
    this.state();signal?.throwIfAborted();
    const cleaned=title.trim();
    if(!cleaned||cleaned.length>256||!operationId.trim()||operationId.length>128)throw new Error('quality/index/invalid-input');
    const proposed={id:randomUUID(),title:cleaned,createdAt:new Date().toISOString(),operationId};
    const write=this.serial.then(async()=>{
      signal?.throwIfAborted();authorizeBeforeWrite();const state=this.domain.global.get();this.assertOwner(state);
      const existing=state.records.find(record=>record.operationId===operationId);
      if(existing){if(existing.title!==cleaned)throw new Error('quality/index/operation-conflict');return structuredClone(existing);}
      if(state.records.length>=1000)throw new Error('quality/index/record-budget-exceeded');
      await this.domain.global.set({...state,records:[...state.records,proposed]});return structuredClone(proposed);
    });this.serial=write.catch(()=>undefined);return write;
  }
  close():Promise<void>{return this.closing??=this.serial.then(()=>this.domain.close());}
  private state(){if(this.closing)throw new Error('quality/index/closed');const state=this.domain.global.get();this.assertOwner(state);return state;}
  private assertOwner(state:z.infer<typeof stateSchema>){if(state.organizationId!==this.actor.organizationId||state.principalId!==this.actor.principalId)throw new Error('quality/index/owner-mismatch');}
}
