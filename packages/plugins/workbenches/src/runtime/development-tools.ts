import {timingCategory,type TimingScope,type WorkbenchDevelopmentTiming} from './development-timing.js';
import {createRequire} from 'node:module';
import type {Context} from '@deepseek-ai/cordis';
import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';

const semver=createRequire(import.meta.url)('semver') as {valid(value:string):string|null};
const exactVersion=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface WorkbenchDevelopmentToolsApi {
  timing?:WorkbenchDevelopmentTiming;
  resolveTimingScope?:(sessionId:string)=>Promise<TimingScope>;
  readContext(sessionId:string,signal?:AbortSignal):Promise<unknown>;
  verifyNativeInstallation(sessionId:string,input:{version:string;sha256:string},signal?:AbortSignal):Promise<unknown>;
}

function allowed(args:unknown,keys:readonly string[]):asserts args is Record<string,unknown>{
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!keys.includes(key)))
    throw Error('workbench/development-invalid-arguments');
}
function session(exec:ToolRunContext):string{
  const id=exec.agent?.id;
  if(typeof id!=='string'||!id.trim()||id.length>256)throw Error('workbench/development-session-required');
  exec.signal.throwIfAborted();return id;
}
async function json(value:Promise<unknown>,signal:AbortSignal){
  const result=await value;signal.throwIfAborted();return JSON.parse(JSON.stringify(result));
}
const output=(label:string)=>({schema:{type:'json' as const},render:(_args:unknown,value:unknown)=>[{type:'text' as const,text:label+'\n'+JSON.stringify(value)}]});

/** Session identity comes only from the official Agent. The Host API owns
 * authorization, source resolution and installed-byte reconciliation. Tool
 * registry registrations are managed by the current official Cordis Fiber. */
export function registerWorkbenchDevelopmentTools(ctx:Context,api:WorkbenchDevelopmentToolsApi){
  const bound=new Set<string>();
  const approvals=new Map<symbol,(failed:boolean)=>Promise<void>>();
  ctx.on('tools/pre-execute',async(exec,next)=>{
    const decision=await next(),id=exec.agent?.id;
    if(decision.kind==='ask'&&typeof id==='string'&&bound.has(id)&&api.timing&&api.resolveTimingScope&&approvals.size<1000){
      try{approvals.set(exec.token,await api.timing.begin(await api.resolveTimingScope(id),'approval'));}catch{}
    }
    return decision;
  });
  ctx.on('tools/result',(exec,result)=>{const finish=approvals.get(exec.token);if(finish){approvals.delete(exec.token);void finish(result.isError).catch(()=>{});}});

  ctx.on('tools/execute',async(exec,next)=>{
    const approval=approvals.get(exec.token);if(approval){approvals.delete(exec.token);try{await approval(false);}catch{}}
    const id=exec.agent?.id;let finish:((failed:boolean)=>Promise<void>)|undefined;
    if(api.timing&&api.resolveTimingScope&&typeof id==='string'&&(bound.has(id)||exec.name==='workbench_read_development_context')){
      try{const scope=await api.resolveTimingScope(id),type=timingCategory(exec.name,exec.arguments,scope);if(type){finish=await api.timing.begin(scope,type);if(bound.size<5000)bound.add(id);}}catch{/* Diagnostics must never change native tool authorization or results. */}
    }
    try{const result=await next();try{await finish?.(result.isError);}catch{}return result;}
    catch(error){try{await finish?.(true);}catch{}throw error;}
  });
  ctx.tools.register(defineTool({
    name:'workbench_read_development_context',
    description:'读取当前原生开发会话已保存的需求、源码、稳定插件身份、目标实例及实际候选包。先调用本工具；开发记录和目录由宿主按会话归属确定，不能指定其他记录或路径。候选包存在不证明它由当前源码生成。向用户说明时使用业务语言，内部标识与内容摘要仅用于实际工具操作。',
    parameters:{},output:output('当前工作台开发上下文'),
    presentCall:()=>({card:'generic',title:'读取开发需求与源码',kind:'read'}),
    presentResult:(_args,result)=>({card:'generic',title:result.isError?'开发上下文读取未完成':'已读取开发需求与源码',...(!result.isError?{content:[{type:'text' as const,text:'本轮需求、源码与目标实例已读取。'}]}:{})}),
    async execute(args,exec){allowed(args,[]);return json(api.readContext(session(exec),exec.signal),exec.signal);},
  }));
  ctx.tools.register(defineTool({
    name:'workbench_verify_native_installation',
    description:'原生 plugin_manager install_bundle 安装后，核对本会话关联工作台的实际安装字节、版本和候选包并登记。参数仅接受实际候选版本和SHA256。activationVerified:false 仅表示本工具不核验启用，并非停用或失败，不能据此重复安装。用户已授权启用时按回执先 list_bundles 核对实际包名，再 set_bundle；不要猜 entryId 或用 set_plugin。未获启用授权则留在工作台列表。页面与业务需在当前已认证宿主应用验收：Desktop 用运行中的 WebView，Web 用当前已登录页面；独立任务浏览器401不代表应用失败，不得探查或复制凭据绕过。',
    parameters:{version:{type:'string',required:true,description:'实际候选包的完整、规范SemVer版本。'},sha256:{type:'string',required:true,description:'实际tgz字节的64位小写SHA256。'}},
    output:output('工作台安装核对结果'),
    presentCall:()=>({card:'generic',title:'核对工作台安装',kind:'read'}),
    presentResult:(_args,result)=>({card:'generic',title:result.isError?'工作台安装核对未完成':'工作台安装核对结果',...(!result.isError?{content:[{type:'text' as const,text:'安装字节已核对并登记；启用状态尚未核验，不表示启用失败。启用、重启与宿主页面验收需分别确认。'}]}:{})}),
    async execute(args,exec){
      allowed(args,['version','sha256']);
      if(typeof args.version!=='string'||args.version.length>256||!exactVersion.test(args.version)||semver.valid(args.version)===null||
        typeof args.sha256!=='string'||!/^[a-f0-9]{64}$/.test(args.sha256))throw Error('workbench/development-invalid-arguments');
      return json(api.verifyNativeInstallation(session(exec),{version:args.version,sha256:args.sha256},exec.signal),exec.signal);
    },
  }));
}
