import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,realpath,stat,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
export type TimingCategory='sdk'|'coding'|'delivery'|'installation'|'preparation'|'approval';
const category=z.enum(['sdk','coding','delivery','installation','preparation','approval']);
const event=z.object({id:z.string().max(128),category,startedAt:z.string().datetime(),finishedAt:z.string().datetime().optional(),durationMs:z.number().finite().nonnegative().optional(),status:z.enum(['running','passed','failed','interrupted']),runId:z.string().max(128)}).strict();
const schema=z.object({schemaVersion:z.literal(1),events:z.array(event).max(1000),limitReached:z.boolean()}).strict();
type State=z.infer<typeof schema>;
export interface TimingScope{key:string;source:string;sdkDirectory?:string;guard:()=>Promise<void>;}
const inside=(root:string,path:string)=>{const r=relative(root,path);return r===''||(!r.startsWith('..')&&!isAbsolute(r));};
/** Classifies observed tool dispatches only. Never retain arguments, commands,
 * output, credentials or file contents in timing storage. */
export function timingCategory(name:string,args:unknown,scope:TimingScope):TimingCategory|undefined{
 const a=args&&typeof args==='object'?args as Record<string,unknown>:{};
 const path=[a.file_path,a.path,a.filePath].find(v=>typeof v==='string') as string|undefined;
 if(name==='read'&&path&&scope.sdkDirectory&&inside(scope.sdkDirectory,resolve(scope.source,path)))return 'sdk';
 if(['write','edit','apply_patch'].includes(name)&&path&&inside(scope.source,resolve(scope.source,path)))return 'coding';
 if(name==='plugin_manager'&&a.action==='install_bundle')return 'installation';
 if(name==='workbench_verify_native_installation')return 'installation';
 if(name==='bash'&&typeof a.command==='string'&&(a.command.includes('/scripts/run-delivery.mjs')||/\bnpm\s+run\s+deliver\b/.test(a.command)))return 'delivery';
 if(name==='workbench_read_development_context'||name==='read')return 'preparation';
 return undefined;
}
/** Host-only diagnostic store. Ownership/revision is checked before reads and
 * each atomic write. It confers no installation or acceptance authority. */
export class WorkbenchDevelopmentTiming {
 private readonly runId=randomUUID();private queue:Promise<unknown>=Promise.resolve();
 constructor(private readonly directory:string){}
 private async path(key:string){if(!/^[a-f0-9]{64}$/.test(key))throw Error('workbench/timing-invalid-scope');await mkdir(this.directory,{recursive:true,mode:0o700});if(await realpath(this.directory)!==this.directory)throw Error('workbench/timing-invalid-storage');return join(this.directory,key+'.json');}
 private async load(path:string):Promise<State>{try{if((await stat(path)).size>1024*1024)throw Error('workbench/timing-report-limit');if(await realpath(path)!==path)throw Error('workbench/timing-invalid-storage');return schema.parse(JSON.parse(await readFile(path,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {schemaVersion:1,events:[],limitReached:false};throw e;}}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const next=this.queue.then(run,run);this.queue=next.catch(()=>{});return next;}
 async begin(scope:TimingScope,type:TimingCategory){
  const start=performance.now(),id=randomUUID(),startedAt=new Date().toISOString();
  await this.serial(async()=>{await scope.guard();const path=await this.path(scope.key),state=await this.load(path);if(state.events.length>=1000)state.limitReached=true;else state.events.push({id,category:type,startedAt,status:'running',runId:this.runId});await this.save(path,state,scope.guard);});
  return async(failed:boolean)=>{const durationMs=Math.max(0,performance.now()-start);await this.serial(async()=>{await scope.guard();const path=await this.path(scope.key),state=await this.load(path),row=state.events.find(e=>e.id===id);if(!row||row.status!=='running')return;row.finishedAt=new Date().toISOString();row.durationMs=Math.round(durationMs*100)/100;row.status=failed?'failed':'passed';await this.save(path,state,scope.guard);});};
 }
 private async save(path:string,state:State,guard:()=>Promise<void>){const temporary=path+'.'+randomUUID()+'.tmp';try{await guard();await writeFile(temporary,JSON.stringify(state),{flag:'wx',mode:0o600});await guard();await rename(temporary,path);}finally{await rm(temporary,{force:true});}}
 async read(scope:TimingScope){return this.serial(async()=>{await scope.guard();const state=await this.load(await this.path(scope.key));await scope.guard();const events=state.events.map(e=>e.status==='running'&&e.runId!==this.runId?{...e,status:'interrupted' as const}:e);return {schemaVersion:1 as const,events:events.map(({runId,...e})=>e),limitReached:state.limitReached,measurement:'tool-dispatch-only' as const};});}
}
export function timingScopeKey(sourceKey:string,iterationId:string){return createHash('sha256').update(JSON.stringify([sourceKey,iterationId])).digest('hex');}
