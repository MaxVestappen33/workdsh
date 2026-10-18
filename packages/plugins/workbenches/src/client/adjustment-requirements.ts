import { parseWorkbenchRequirementsDraft, resolveWorkbenchEditTarget, type WorkbenchRequirementsDraft, type WorkbenchEditTarget } from 'workdsh-contracts';

/** Persist the current iteration request in a new requirement revision. Earlier
 * revisions retain the previous scope; resource and workflow definitions stay intact. */
export function prepareWorkbenchAdjustmentRequirements(baseline: WorkbenchRequirementsDraft, request: string, target?: WorkbenchEditTarget) {
  const current = parseWorkbenchRequirementsDraft(baseline);
  if (typeof request !== 'string' || !request.trim() || request.length > 7000) throw new Error('workbench/invalid-adjustment');
  let scope = '按反馈定位修改范围，开始前确认受影响的模块。';
  if (target) {
    if (!current.system) throw new Error('workbench/invalid-edit-target');
    const resolved = resolveWorkbenchEditTarget(current.system, target);
    scope = `修改目标：${JSON.stringify(resolved.target)}；设计关联模块：${resolved.affectedModuleIds.join('、')}。实际代码影响需核对。`;
  }
  return parseWorkbenchRequirementsDraft({ ...current, firstIteration: [scope, `本轮调整：${request.trim()}`,
    '保留本轮未涉及的页面、数据来源、接口与计算口径，以及历史数据和插件身份。涉及范围扩大先说明影响。'].join('\n') });
}
