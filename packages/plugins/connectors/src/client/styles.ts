import { controlsCss, modalCss } from 'workdsh-ui';

export const connectorCss = `${modalCss}
@layer workdsh-business {

/* ------------------------------------------------------------ 面板骨架 */
.wd-connectors{overflow:auto;box-sizing:border-box}
.wd-connectors{height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px/22px "PingFang SC","Microsoft YaHei",sans-serif;padding:24px}
.wd-connectors *{box-sizing:border-box}
.wd-connectors button,.wd-connectors input,.wd-connectors select,.wd-connectors textarea{font:inherit;color:inherit}
.wd-connectors button{cursor:pointer}
.wd-connectors button:disabled{cursor:not-allowed}
.wd-connectors button:disabled{opacity:.55}
.wd-connectors .nav-toggle{display:none}
.wd-connectors :focus-visible,.connector-detail-dialog :focus-visible,.connector-config-dialog :focus-visible,.connector-confirm-dialog :focus-visible{outline-offset:3px}
.wd-connectors :focus-visible,.connector-detail-dialog :focus-visible,.connector-config-dialog :focus-visible,.connector-confirm-dialog :focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}

/* --------------------------------------------------- 顶部操作区（能力中心 Tab） */
.wd-connectors .cap-header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:26px}
.wd-connectors .cap-tab{display:flex;align-items:center;gap:7px;min-height:36px;padding:6px 12px}
.wd-connectors .cap-tab{border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.wd-connectors .cap-tab:hover:not(:disabled),.wd-connectors .cap-tab.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-connectors .cap-tab.active{font-weight:500}
.wd-connectors .cap-tab:disabled{color:var(--dsw-alias-label-tertiary)}
.wd-connectors .cap-tab svg{color:var(--dsw-alias-label-tertiary)}
.wd-connectors .cap-tab.active svg{color:var(--dsw-alias-label-primary)}
.wd-connectors .head-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
.wd-connectors .search{width:250px;min-width:150px}
.wd-connectors .secondary.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}

/* ------------------------------------------------------------ 标题与二级 Tab */
.wd-connectors .section-head{display:flex;align-items:baseline;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.wd-connectors .section-head h1{margin:0}
.wd-connectors .section-head h1{font-size:25px;line-height:34px;font-weight:600}
.wd-connectors .head-meta{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-connectors .source-tabs{display:flex;gap:26px;margin:0 0 18px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.wd-connectors .source-tabs button{display:inline-flex;align-items:center;gap:8px;padding:11px 2px;margin-bottom:-1px}
.wd-connectors .source-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--dsw-alias-label-secondary)}
.wd-connectors .source-tabs button:hover{color:var(--dsw-alias-label-primary)}
.wd-connectors .source-tabs button.active{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.wd-connectors .source-tabs .count{display:inline-grid;place-items:center;min-width:24px;height:20px;padding:0 7px}
.wd-connectors .source-tabs .count{border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px;font-style:normal;font-weight:500}

/* ------------------------------------------------- 分类胶囊栏 + 「更多」浮层 */
.wd-connectors .category-bar{position:relative;display:flex;align-items:center;gap:7px;margin:0 0 18px;min-width:0}
.wd-connectors .category-tabs{display:flex;gap:7px;min-width:0}
.wd-connectors .category-tabs button[data-category],.wd-connectors .more-btn{padding:5px 13px;border:0;border-radius:999px}
.wd-connectors .category-tabs button[data-category],.wd-connectors .more-btn{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.wd-connectors .category-tabs button[data-category]:hover,.wd-connectors .more-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-connectors .category-tabs button[data-category].active{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600}
.wd-connectors .category-tabs button[hidden],.wd-connectors .more-wrap[hidden],.wd-connectors .more-panel[hidden]{display:none}
.wd-connectors .more-wrap{position:relative;flex:none;display:inline-flex}
.wd-connectors .more-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 12px}
.wd-connectors .more-btn .chev{display:inline-flex;transition:transform .12s ease}
.wd-connectors .more-btn.open .chev{transform:rotate(180deg)}
.wd-connectors .more-panel{position:absolute;top:calc(100% + 8px);right:0;z-index:30;min-width:168px;padding:8px}
.wd-connectors .more-panel{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-panel)}
.wd-connectors .more-panel button{display:block;width:100%;padding:9px 12px;text-align:left;white-space:nowrap}
.wd-connectors .more-panel button{border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary)}
.wd-connectors .more-panel button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-connectors .more-panel button.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}

/* ------------------------------------------------------------ 批量操作条与提示 */
.wd-connectors .batch-bar{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin:0 0 16px;padding:10px 12px}
.wd-connectors .batch-bar{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.wd-connectors .batch-bar span{margin-right:auto;color:var(--dsw-alias-label-secondary)}
.wd-connectors .error,.connector-config-dialog .error,.connector-detail-dialog .error{margin:0 0 14px;color:#ff746c}
.wd-connectors .error button{margin-left:10px}
.wd-connectors .notice{margin:0 0 14px;color:#55ce63}
.wd-connectors .muted{color:var(--dsw-alias-label-tertiary)}

/* ------------------------------------------------------------ 卡片网格与卡片 */
.wd-connectors .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px}
.wd-connectors .card{position:relative;display:flex;flex-direction:column;min-width:0;min-height:148px;padding:14px;text-align:left}
.wd-connectors .card{border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-layer-2);transition:border-color .12s ease,background .12s ease}
.wd-connectors .card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.wd-connectors .card.is-off{opacity:.58}
.wd-connectors .card.is-selected{border-color:var(--dsw-alias-brand-primary)}
.wd-connectors .card-top{display:flex;align-items:center;gap:14px;min-width:0}
.wd-connectors .card-open{display:flex;align-items:center;gap:14px;flex:1;min-width:0;padding:0;text-align:left}
.wd-connectors .card-open{border:0;background:transparent;color:inherit}
.wd-connectors .card-open:hover{background:transparent}
.wd-connectors .mark{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:13px;color:#fff;font-size:19px;font-weight:700}
.wd-connectors .mark{overflow:hidden}
.wd-connectors .mark img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.wd-connectors .mark.fallback{background:linear-gradient(145deg,#146c7c,#11b7c8);color:#eafcff}
.wd-connectors .mark.large{width:48px;height:48px;border-radius:13px;font-size:20px}
.wd-connectors .card-title{display:flex;flex-direction:column;gap:3px;min-width:0}
.wd-connectors .card-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-connectors .card-title strong{font-size:16px;font-weight:600}
.wd-connectors .card-title small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-connectors .card-title small{color:var(--dsw-alias-label-tertiary);font-size:11px}
.wd-connectors .card-title small.tag{color:var(--dsw-alias-label-secondary);font-size:12px}
.wd-connectors .card-desc{overflow:hidden;margin:8px 0 0;height:42px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:21px}
.wd-connectors .card-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.wd-connectors .card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:10px}
.wd-connectors .card-foot{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-connectors .status-line{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-tertiary)}
.wd-connectors .dot,.connector-detail-dialog .dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed)}
.wd-connectors .dot.ready,.connector-detail-dialog .dot.ready{background:#55ce63;box-shadow:0 0 0 3px #55ce6329}
.wd-connectors .dot.offline,.connector-detail-dialog .dot.offline{background:#ff746c}
.wd-connectors .dot.discovering,.connector-detail-dialog .dot.discovering{background:#efb44f;animation:wd-connector-pulse 1s ease-in-out infinite}
@keyframes wd-connector-pulse{50%{opacity:.35}}

/* ------------------------------------------------------------ 开关与卡片操作 */
.wd-connectors .switch,.connector-detail-dialog .switch{flex:none;width:34px;height:20px;min-height:20px;padding:2px}
.wd-connectors .switch,.connector-detail-dialog .switch{border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover)}
.wd-connectors .switch::after,.connector-detail-dialog .switch::after{content:"";display:block;width:16px;height:16px;border-radius:50%;background:#fff;transition:margin .15s ease}
.wd-connectors .switch[aria-checked="true"],.connector-detail-dialog .switch[aria-checked="true"]{background:#1fc9ad}
.wd-connectors .switch[aria-checked="true"]::after,.connector-detail-dialog .switch[aria-checked="true"]::after{margin-left:14px}
.wd-connectors .card-delete{flex:none;display:grid;place-items:center;width:30px;height:30px;padding:0}
.wd-connectors .card-delete{border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary)}
.wd-connectors .card-delete:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:#ff746c}
.wd-connectors .card-delete svg{width:16px;height:16px}
.wd-connectors .batch-check{flex:none;display:grid;place-items:center;width:24px;height:24px;padding:0}
.wd-connectors .batch-check{border:1px solid var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-bg-layer-1);color:transparent;font-size:13px;font-weight:700}
.wd-connectors .batch-check[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}

/* ------------------------------------------------------------ 市场卡片 */
.wd-connectors .stats{display:flex;align-items:center;gap:14px;margin-top:auto;padding-top:10px}
.wd-connectors .stats{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-connectors .stat{display:flex;align-items:center;gap:5px;white-space:nowrap}
.wd-connectors .stat svg{width:15px;height:15px}
.wd-connectors .plus{display:grid;place-items:center;width:36px;padding:0}
.wd-connectors .plus{border:1px solid var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.wd-connectors .plus:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wd-connectors .installed-pill{flex:none;padding:4px 10px;border-radius:999px}
.wd-connectors .installed-pill{background:var(--dsw-alias-bg-layer-1);color:#55ce63;font-size:12px;font-weight:500}
.wd-connectors .market-foot{display:flex;justify-content:center;padding:22px 0 6px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-connectors .empty{padding:64px 20px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.wd-connectors .empty strong{display:block;margin-bottom:6px}
.wd-connectors .empty strong{color:var(--dsw-alias-label-secondary);font-size:16px}

/* ------------------------------------------------------------ 详情弹窗 */
.wd-dialog.connector-detail-dialog{width:min(820px,calc(100vw - 40px))}
.connector-detail-dialog{padding:24px}
.connector-detail-dialog .detail-hero{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:16px;align-items:center}
.connector-detail-dialog .detail-hero{padding-right:52px}
.connector-detail-dialog .detail-title{min-width:0}
.connector-detail-dialog .detail-title h1{margin:0 0 4px}
.connector-detail-dialog .detail-title h1{font-size:20px;overflow-wrap:anywhere}
.connector-detail-dialog .detail-actions{display:flex;align-items:center;gap:9px}
.connector-detail-dialog .detail-summary{margin:20px 0}
.connector-detail-dialog .detail-summary{color:var(--dsw-alias-label-secondary)}
.connector-detail-dialog .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;padding:16px}
.connector-detail-dialog .metrics{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.connector-detail-dialog .metric small{display:block}
.connector-detail-dialog .metric small{color:var(--dsw-alias-label-tertiary);font-size:12px}
.connector-detail-dialog .metric strong{font-size:15px}
.connector-detail-dialog .tool-list{grid-column:1/-1;padding:14px;border-radius:8px}
.connector-detail-dialog .tool-list{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:13px}
.connector-detail-dialog .tool-list-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.connector-detail-dialog .tool-list-head{color:var(--dsw-alias-label-secondary);font-weight:500}
.connector-detail-dialog .tool-list-head .muted{color:var(--dsw-alias-label-tertiary);font-weight:400}
.connector-detail-dialog .tool-item{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.connector-detail-dialog .tool-item:first-of-type{border-top:0}
.connector-detail-dialog .tool-item-top{display:flex;align-items:center;gap:8px}
.connector-detail-dialog .tool-item code{margin:0;overflow-wrap:anywhere}
.connector-detail-dialog .tool-item code,.connector-detail-dialog code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#a8c9ff}
.connector-detail-dialog .tool-tag{margin-left:auto;padding:1px 8px;border-radius:999px}
.connector-detail-dialog .tool-tag{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px}
.connector-detail-dialog .tool-item p{margin:6px 0 0;color:var(--dsw-alias-label-secondary)}
.connector-detail-dialog .tool-item small{display:block;margin-top:4px}
.connector-detail-dialog .tool-item small,.connector-detail-dialog .tool-empty{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.connector-detail-dialog .tool-empty{margin:12px 0 0}
.connector-detail-dialog .detail-footer{display:flex;align-items:center;gap:9px;margin-top:20px}
.connector-detail-dialog .detail-footer .spacer{margin-left:auto}
.connector-detail-dialog .danger,.connector-config-dialog .danger{color:#ff8f89}

/* ------------------------------------------------------------ 表单与确认弹窗 */
.wd-dialog.connector-config-dialog{width:min(680px,calc(100vw - 32px))}
.wd-dialog.connector-confirm-dialog{width:min(480px,calc(100vw - 32px))}
.connector-config-dialog,.connector-confirm-dialog{padding:24px}
.connector-config-dialog h1,.connector-confirm-dialog h2{margin:0}
.connector-config-dialog h1{padding-right:44px;font-size:20px}
.connector-config-dialog p{color:var(--dsw-alias-label-tertiary)}
.connector-config-dialog .connector-form{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px}
.connector-config-dialog label{display:grid;gap:6px}
.connector-config-dialog label{color:var(--dsw-alias-label-tertiary);font-size:12px}
.connector-config-dialog label.wide,.connector-config-dialog .wide{grid-column:1/-1}
.connector-config-dialog :is(input,.wd-form-input),.connector-config-dialog select,.connector-config-dialog textarea{width:100%}
.connector-config-dialog input,.connector-config-dialog select,.connector-config-dialog textarea{padding:10px 12px}
.connector-config-dialog input,.connector-config-dialog select,.connector-config-dialog textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:14px/20px inherit}
.connector-config-dialog textarea{min-height:88px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.connector-config-dialog .form-note{padding:11px 13px;border-radius:9px}
.connector-config-dialog .form-note{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:12px}
.connector-config-dialog .form-actions,.connector-confirm-dialog .form-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}
.connector-config-dialog .form-actions.wide{margin-top:4px}
.connector-confirm-dialog p{color:var(--dsw-alias-label-tertiary);line-height:1.7}

/* ------------------------------------------------------------ 窄屏 */
@media(max-width:1400px){.wd-connectors .grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:1100px){.wd-connectors .grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:900px){.wd-connectors .head-tools{width:100%;margin-left:0}
.wd-connectors .search{flex:1;width:100%}
.connector-detail-dialog .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
.connector-detail-dialog .detail-hero{grid-template-columns:48px minmax(0,1fr)}
.connector-detail-dialog .detail-actions{grid-column:1/-1}}
@media(max-width:620px){.wd-connectors{padding:16px}
.wd-connectors .nav-toggle{display:block}
.wd-connectors .grid{grid-template-columns:1fr}
.connector-config-dialog .connector-form{grid-template-columns:1fr}
.connector-detail-dialog{padding:24px 20px}}



}
${controlsCss}
`;
