import type {createWorkbenchDevelopmentClient} from './development-client.js';
import type {createWorkbenchRequirementsClient} from './requirements-client.js';
import {createWorkbenchDevelopmentInstruction} from './development-instruction.js';
/** A continuation reads the latest saved requirement and verifies the same native
 * Session/source. It neither appends a requirement nor submits a model prompt. */
export async function prepareWorkbenchResume(developments:Pick<ReturnType<typeof createWorkbenchDevelopmentClient>,'list'|'ensureSession'>,
 requirements:Pick<ReturnType<typeof createWorkbenchRequirementsClient>,'history'>,id:string,signal?:AbortSignal){
 const row=(await developments.list(signal)).find(row=>row.development.id===id);signal?.throwIfAborted();
 if(!row)throw Error('workbench/development-not-found');
 const entry=await developments.ensureSession(id,row.development.revision,signal);signal?.throwIfAborted();
 const saved=(await requirements.history(id,signal)).at(-1);signal?.throwIfAborted();
 if(!saved||saved.id!==entry.development.requirementsRevision)throw Error('workbench/requirements-revision-conflict');
 // Confirmation and continuation share one canonical instruction. Adding a
 // continuation preamble here makes the still-pending confirmation draft look
 // like user-authored content and prevents the native owner from submitting it.
 return {entry,requirements:saved.requirements,instruction:createWorkbenchDevelopmentInstruction(saved,entry.development)};
}

/** Codes are Host-owned; never render raw exception text or filesystem paths. */
export function resumeFailureMessage(cause:unknown):string {
 const code=cause instanceof Error?('code' in cause?cause.code:cause.message):undefined;
 switch(code){
  case 'workbench/installation-target-changed':return '开发记录与当前运行环境不一致。需求和源码已保留，请先核对原环境与源码位置；重新打包不能修复此关联。';
  case 'workbench/development-source-unavailable':case 'workbench/source-identity-mismatch':case 'workbench/source-directory-outside':return '源码关联未通过核对。请核对原开发目录，勿改用其他应用的目录；需求和已有对话已保留。';
  case 'workbench/development-creator-required':return '原会话未启用官方创造模式，无法作为开发会话继续。请核对会话模式，需求和源码已保留。';
  case 'workbench/requirements-revision-conflict':case 'workbench/development-revision-conflict':return '需求或开发记录已经更新。请重新核对最新记录，再准备本轮草稿。';
  case 'workbench/development-access-denied':return '当前身份无权继续这份开发记录，请切回有权限的账号。';
  case 'workbench/session-authority-unavailable':return '原生开发会话服务尚未就绪，请稍后重新核对。';
  case 'workbench/development-not-found':return '未找到这份开发记录，请返回“我的开发”核对。';
  default:return '暂时无法核对开发状态。请稍后重试；需求、源码和已有对话未被替换。';
 }
}
