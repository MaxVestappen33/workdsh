import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { defineDomain, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { verifyInstalledWorkbenchArtifact } from './installed-artifact.js';
import { retainWorkbenchArtifact } from './retain-artifact.js';
import type { RetainedWorkbenchArchive } from './installation-verifier.js';

const entrySchema = z.object({ packageName:z.string().min(1).max(214), version:z.string().min(1).max(128),
  workbenchId:z.string().min(1).max(128), sha256:z.string().regex(/^[a-f0-9]{64}$/),
  path:z.string().min(1).max(8192).refine(isAbsolute), verifiedAt:z.string().datetime() });
const stateSchema = z.object({ installationId:z.string(), installationRoot:z.string(), entries:z.array(entrySchema) });
function specification(installationId:string, installationRoot:string) {
  const key=createHash('sha256').update(installationId).digest('hex').slice(0,40);
  return defineDomain({name:`workdsh_install_archives_${key}`,version:1,global:{schema:stateSchema,
    initial:{installationId,installationRoot,entries:[]}},tables:{}});
}
type ArchiveDomain=Domain<ReturnType<typeof specification>>;
/** Single Host owner. Records observed installed contents, without asserting
 * activation. No RPC exposes archive paths or accepts these facts from pages. */
export class WorkbenchInstallationArchives {
  private queue:Promise<unknown>=Promise.resolve();
  private closing?:Promise<void>;
  private constructor(private readonly domain:ArchiveDomain, private readonly installationId:string, private readonly root:string) {}
  static async open(storage:DomainFacility,installationId:string,installationRoot:string) {
    if (!installationId.trim() || installationId.length>256 || !isAbsolute(installationRoot)) throw new Error('workbench/invalid-installation-target');
    const store=new WorkbenchInstallationArchives(await storage.open(specification(installationId,installationRoot)),installationId,installationRoot);
    try {store.read();return store;} catch(cause) {await store.close();throw cause;}
  }
  async retainVerified(input:Omit<z.infer<typeof entrySchema>,'verifiedAt'>, authorize:()=>void, signal?:AbortSignal) {
    this.assertOpen();
    const captured=entrySchema.parse({...input,verifiedAt:new Date().toISOString()});
    const pending=this.queue.then(async()=>{
      signal?.throwIfAborted();authorize();
      await verifyInstalledWorkbenchArtifact(this.root,captured.path,captured,signal);
      signal?.throwIfAborted();authorize();
      const state=this.read(), existing=state.entries.find(row=>row.packageName===captured.packageName && row.version===captured.version);
      if (existing && (existing.sha256!==captured.sha256 || existing.workbenchId!==captured.workbenchId)) throw new Error('workbench/installation-version-conflict');

      if (state.entries.length>=4096) throw new Error('workbench/installation-archive-limit');
      const retainedPath=await retainWorkbenchArtifact(this.root,captured.path,captured,signal);
      signal?.throwIfAborted();authorize();
      const retained={...captured,path:retainedPath};
      await this.domain.global.set({...state,entries:existing ? state.entries.map(row=>row===existing ? retained : row) : [...state.entries,retained]});
    });
    this.queue=pending.catch(()=>undefined);return pending;
  }
  resolve(packageName:string,version:string):RetainedWorkbenchArchive {
    this.assertOpen();
    const row=this.read().entries.find(item=>item.packageName===packageName && item.version===version);
    if (!row) throw new Error('workbench/installation-archive-unavailable');
    return Object.freeze({path:row.path,sha256:row.sha256,workbenchId:row.workbenchId});
  }
  close():Promise<void> {if(!this.closing)this.closing=this.queue.then(()=>this.domain.close());return this.closing;}
  private read() {const state=this.domain.global.get();if(state.installationId!==this.installationId || state.installationRoot!==this.root) throw new Error('workbench/installation-target-mismatch');return state;}
  private assertOpen() {if(this.closing)throw new Error('workbench/installation-store-closed');}
}
