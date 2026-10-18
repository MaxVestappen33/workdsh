/** Display only owned status fields; never render raw Host exception paths. */
export function requirementsSaveFailureMessage(cause:unknown){
 const error=cause&&typeof cause==='object'?cause as {code?:unknown;requirementsSaved?:unknown;preparationStage?:unknown}:undefined;
 if(error?.requirementsSaved===true){
  if(error.code==='workbench/sdk-package-unavailable')return '需求已保存，但平台开发 SDK 无法读取，开发工程尚未准备完成。请核对平台安装后重试；需求和原有会话会保留。';
  if(error.preparationStage==='source')return '需求已保存，但开发源码准备失败。请保留当前内容，修复后重试；不会重复创建应用。';
  if(error.preparationStage==='session')return '需求已保存，但原生开发会话尚未关联。请保留当前内容，核对后重试。';
  return '需求已保存，但开发记录尚未准备完成。请保留当前内容，核对后重试。';
 }
 if(error?.code==='workbench/creation-conflict')return '需求摘要或已保存内容已经变化。当前编辑仍保留，请核对最新摘要后继续。';
 return '需求保存或开发准备尚未确认完成，内容已保留，请核对开发记录后重试。';
}
