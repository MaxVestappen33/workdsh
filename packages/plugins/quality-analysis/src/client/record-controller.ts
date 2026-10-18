import type {createQualityRecordClient,QualityRecordSummary,QualityRecordDetail} from './record-client.js';
export interface QualityRecordsState {readonly records:readonly QualityRecordSummary[];readonly busy:boolean;readonly error?:string;readonly pendingTitle?:string;}
/** One instance per identity scope. Disposal cancels requests and discards late results. */
export class QualityRecordController {
  private state:QualityRecordsState=Object.freeze({records:Object.freeze([]),busy:false});
  private listeners=new Set<()=>void>();private request?:AbortController;private disposed=false;
  private intent?:{title:string;operationId:string};
  constructor(private readonly client:ReturnType<typeof createQualityRecordClient>,private readonly newOperationId:()=>string=()=>crypto.randomUUID()){}
  snapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  async refresh():Promise<void>{
    const request=this.begin();if(!request)return;
    try{const records=await this.client.list(request.signal);if(this.current(request)){const found=this.intent&&records.find(row=>row.operationId===this.intent!.operationId);if(found&&found.title===this.intent!.title)this.intent=undefined;this.update({records,busy:false,pendingTitle:this.intent?.title});}}
    catch{if(this.current(request))this.update({...this.state,busy:false,error:'记录读取失败，请重试。'});}
    finally{if(this.request===request)this.request=undefined;}
  }
  async create(title:string):Promise<QualityRecordSummary|undefined>{
    const cleaned=title.trim();if(!cleaned||cleaned.length>256)throw new Error('quality/records/invalid-title');
    if(this.intent&&this.intent.title!==cleaned)throw new Error('quality/records/pending-intent');
    const request=this.begin();if(!request)return;
    this.intent??={title:cleaned,operationId:this.newOperationId()};this.update({...this.state,pendingTitle:cleaned});
    try{
      const record=await this.client.create(this.intent.title,this.intent.operationId,request.signal);
      if(!this.current(request))return;
      this.intent=undefined;const records=Object.freeze([...this.state.records.filter(row=>row.id!==record.id),record]);
      this.update({records,busy:false});return record;
    }catch{if(this.current(request))this.update({...this.state,busy:false,error:'创建结果尚未确认，请使用相同名称重试或刷新列表核对。'});}
    finally{if(this.request===request)this.request=undefined;}
  }
  async open(recordId:string):Promise<QualityRecordDetail|undefined>{
    const request=this.begin();if(!request)return;
    try{const detail=await this.client.get(recordId,request.signal);if(!this.current(request))return;this.update({...this.state,busy:false});return detail;}
    catch{if(this.current(request))this.update({...this.state,busy:false,error:'记录打开失败，请核对权限或刷新列表。'});}
    finally{if(this.request===request)this.request=undefined;}
  }
  cancel(){this.request?.abort();this.request=undefined;if(!this.disposed)this.update({...this.state,busy:false,error:this.intent?'创建结果尚未确认，请刷新列表核对或重试。':undefined});}
  dispose(){this.disposed=true;this.request?.abort();this.request=undefined;this.listeners.clear();}
  private begin(){if(this.disposed)throw new Error('quality/records/closed');if(this.request)return;const request=new AbortController();this.request=request;this.update({...this.state,busy:true,error:undefined});return request;}
  private current(request:AbortController){return !this.disposed&&this.request===request&&!request.signal.aborted;}
  private update(state:QualityRecordsState){this.state=Object.freeze(state);for(const listener of this.listeners)listener();}
}
