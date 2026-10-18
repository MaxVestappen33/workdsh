import type { WorkbenchCatalogEntry } from './catalog-client.js';
export function catalogStatus(entry: WorkbenchCatalogEntry) {
  if (entry.errorCode) return {label:'安装未核验', detail:'未能核对安装内容。请刷新重试；需要替换插件包时可使用本页的导入入口。'};
  if (!entry.compatible) return {label:'版本不兼容', detail:'此版本不适用于当前宿主，请安装兼容版本。'};
  if (!entry.selected) return {label:'已停用'};
  if (entry.runtimeStatus === 'failed') return {label:'加载失败', detail:'宿主报告插件组件加载失败。刷新可重新核对；若仍失败，请继续开发修复并安装新版本。刷新不会自动修复代码。'};
  if (entry.runtimeStatus === 'unloading') return {label:'正在卸载', detail:'宿主正在释放组件，请稍后刷新。'};
  if (entry.runtimeStatus === 'loading') return {label:'正在加载', detail:'宿主正在加载组件，请稍后刷新。'};
  if (entry.registered) return {label:'已启用'};
  if (entry.runtimeStatus === 'active') return {label:'业务尚未就绪', detail:'插件组件已运行，但尚未确认此安装版本的工作台注册。请刷新；若仍未就绪，继续开发核对注册实现。'};
  return {label:'运行状态未确认', detail:'已启用此插件，但尚未确认组件状态及工作台注册。请刷新核对，不能据此认定正在加载。'};
}
