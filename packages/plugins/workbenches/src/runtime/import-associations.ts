import { createHash, randomUUID } from 'node:crypto';
import { defineDomain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { assertActorContext, type ActorContext } from 'workdsh-contracts';
const text = z.string().trim().min(1).max(128);
const record = z.object({ id: text, workbenchId: text, packageName: z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
  target: z.object({hostId:text,installationId:text,profileId:text,harnessVersion:text}).strict(), createdAt:z.string().datetime() }).strict();
const state = z.object({organizationId:text, principalId:text, entries:z.array(record)});
function spec(actor:ActorContext) {
  const key=createHash('sha256').update(JSON.stringify([actor.organizationId,actor.principalId])).digest('hex').slice(0,40);
  return defineDomain({name:`workdsh_import_associations_${key}`,version:1,global:{schema:state,initial:{organizationId:actor.organizationId,principalId:actor.principalId,entries:[]}},tables:{}});
}
/** Host-only ownership reference for offline imports. It is neither a fabricated
 * authoring requirement nor evidence that a package has been installed.
 * Callers must verify retained package identity and current access before binding. */
export async function openWorkbenchImportAssociations(storage:DomainFacility, actor:ActorContext) {
  assertActorContext(actor); const owner={...actor}; const domain=await storage.open(spec(owner));
  let serial:Promise<unknown>=Promise.resolve(), closing:Promise<void>|undefined;
  const read=()=>{if(closing)throw new Error('workbench/import-store-closed');const value=domain.global.get();
    if(value.organizationId!==owner.organizationId||value.principalId!==owner.principalId)throw new Error('workbench/import-owner-mismatch');return value;};
  return {
    list:()=>structuredClone(read().entries),
    bind:async(input:{workbenchId:string;packageName:string;target:z.infer<typeof record>['target']}, authorize:()=>void, signal?:AbortSignal)=>{
      const candidate=record.parse({...structuredClone(input),id:randomUUID(),createdAt:new Date().toISOString()});
      const pending=serial.then(async()=>{signal?.throwIfAborted();authorize();const current=read();
        const existing=current.entries.find(row=>row.workbenchId===candidate.workbenchId||row.packageName===candidate.packageName);
        if(existing){if(existing.workbenchId!==candidate.workbenchId||existing.packageName!==candidate.packageName||JSON.stringify(existing.target)!==JSON.stringify(candidate.target))throw new Error('workbench/import-association-conflict');return structuredClone(existing);}
        await domain.global.set({...current,entries:[...current.entries,candidate]});return structuredClone(candidate);
      });serial=pending.catch(()=>undefined);return pending;
    },
    close:()=>closing??=(serial.then(()=>domain.close())),
  };
}
