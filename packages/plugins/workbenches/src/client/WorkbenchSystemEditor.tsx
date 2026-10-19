import React from 'react';
import { type WorkbenchSystemDefinition } from 'workdsh-contracts';
export function WorkbenchSystemEditor({ value, onChange, disabled }: {
  readonly value?: WorkbenchSystemDefinition;
  readonly onChange: (value: WorkbenchSystemDefinition) => void;
  readonly disabled: boolean;
}) {
  const modules = value?.modules ?? [];
  const commit = (next: WorkbenchSystemDefinition['modules']) => onChange({ schemaVersion: '1', modules: next });
  const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
  return <section aria-label="工作台系统模块定义">
    <h2>系统模块与页面</h2>
    <p>模块与页面使用稳定编号；名称可以调整。依赖用于提示修改影响，不授予资源权限。</p>
    {modules.map(module => <fieldset key={module.id} disabled={disabled} style={{ margin: '16px 0', padding: 16 }}>
      <legend>{module.title}</legend>
      <label>模块名称 <input value={module.title} maxLength={80} onChange={event => {
        const title = event.target.value;
        commit(modules.map(row => row.id === module.id ? { ...row, title } : row));
      }} /></label>
      <p><small>{module.id}</small></p>
      {module.pages.map(page => <label key={page.id} style={{ display: 'block', margin: '8px 0' }}>页面名称 <input value={page.title} maxLength={80} onChange={event => {
        const title = event.target.value;
        commit(modules.map(row => row.id === module.id ? { ...row, pages: row.pages.map(item => item.id === page.id ? { ...item, title } : item) } : row));
      }} /><button type="button" disabled={module.pages.length <= 1} onClick={() => commit(modules.map(row => row.id === module.id ? { ...row, pages: row.pages.filter(item => item.id !== page.id) } : row))}>移除页面</button></label>)}
      <button type="button" disabled={module.pages.length >= 16} onClick={() => commit(modules.map(row => row.id === module.id ? { ...row, pages: [...row.pages, { id: id('page'), title: '新页面' }] } : row))}>添加页面</button>
      <p>依赖模块</p>
      {modules.filter(row => row.id !== module.id).map(row => <label key={row.id} style={{ marginRight: 12 }}><input type="checkbox" checked={module.dependsOn.includes(row.id)} onChange={event => {
        const dependsOn = event.target.checked ? [...module.dependsOn, row.id] : module.dependsOn.filter(id => id !== row.id);
        commit(modules.map(item => item.id === module.id ? { ...item, dependsOn } : item));
      }} />{row.title}</label>)}
      <p><button type="button" disabled={modules.length <= 1 || modules.some(row => row.dependsOn.includes(module.id))} onClick={() => commit(modules.filter(row => row.id !== module.id))}>移除模块</button></p>
      {modules.some(row => row.dependsOn.includes(module.id)) && <p role="note">其他模块仍依赖此模块，解除依赖后才能移除。删除的是当前需求草稿结构，不删除业务数据或源码。</p>}
    </fieldset>)}
    <button type="button" disabled={disabled || modules.length >= 64} onClick={() => commit([...modules, { id: id('module'), title: '新业务模块', pages: [{ id: id('page'), title: '模块首页' }], dependsOn: [] }])}>添加业务模块</button>
  </section>;
}
