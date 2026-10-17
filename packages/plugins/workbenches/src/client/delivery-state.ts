import type{WorkbenchCatalogEntry}from'./catalog-client.js';
export function workbenchDeliveryState(row:WorkbenchCatalogEntry|undefined,canOpen:boolean,candidateCount:number,accepted:boolean){
 if(!row?.installed)return {key:candidateCount?'built':'developing',title:candidateCount?'版本已生成，待安装':'尚未发现可试用版本',description:candidateCount?'开发产物已发现，安装并打开后还需要按需求试用。':'可以继续在右侧制作；AI 回答结束不会自动标记应用完成。',action:candidateCount?'检查版本并安装':'继续开发'};
 if(row.errorCode||row.runtimeStatus==='failed')return {key:'failed',title:'应用加载未通过',description:'安装文件或运行组件未通过核对。保留当前版本和数据，先检查具体问题。',action:'检查安装与修正'};
 if(!row.compatible)return {key:'incompatible',title:'已安装，版本不兼容',description:'需要修正插件兼容范围或实现后再试用。',action:'检查版本'};
 if(!row.selected)return {key:'disabled',title:'已安装，待启用',description:'已核验安装文件，但尚未选择启用，业务页面还不能打开。',action:'启用应用'};
 if(row.runtimeStatus==='loading'||row.runtimeStatus==='unloading')return {key:'loading',title:'正在切换运行版本',description:'等待宿主加载和页面注册；安装成功不代表已可用。',action:'重新核对'};
 if(!row.registered||row.runtimeStatus!=='active'||!canOpen)return {key:'pending',title:'已启用，等待应用就绪',description:'尚未同时确认 Host 注册和 Client 页面。若更新要求重启，请先保存当前任务，再按原生提示重启。',action:'重新核对'};
 return accepted?{key:'accepted',title:'此版本已由你确认验收',description:'验收记录只适用于当前安装版本和需求修订。后续修改需要重新试用。',action:'使用应用'}:{key:'trial',title:'应用已就绪，等待试用验收',description:'打开应用，按下面的完成标准操作。发现问题可直接记录反馈，沿用同一应用继续修改。',action:'打开应用试用'};
}
