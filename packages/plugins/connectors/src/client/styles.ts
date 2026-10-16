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
.wd-connectors .source-tabs button{display:inline-flex;align-items:center;gap:6px;padding:11px 2px;margin-bottom:-1px}
.wd-connectors .source-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--dsw-alias-label-secondary)}
.wd-connectors .source-tabs button:hover{color:var(--dsw-alias-label-primary)}
.wd-connectors .source-tabs button.active{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
/* 数量徽标：浅灰胶囊 + 与标题齐平的数字，紧贴标题（参考设计稿的「模型 125」样式）。 */
.wd-connectors .source-tabs .count{display:inline-grid;place-items:center;min-width:28px;height:22px;padding:0 9px}
.wd-connectors .source-tabs .count{border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:14px;font-style:normal;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.wd-connectors .source-tabs button:hover .count{color:var(--dsw-alias-label-primary)}
.wd-connectors .source-tabs button.active .count{color:var(--dsw-alias-label-primary)}

/* ------------------------------------------------- 分类胶囊栏 + 「更多」浮层 */
.wd-connectors .category-bar{position:relative;display:flex;align-items:center;gap:7px;margin:0 0 18px;min-width:0}
.wd-connectors .category-tabs{display:flex;gap:4px;min-width:0}
/* 胶囊尺寸与圆角：参考设计稿的分类标签（圆角矩形，不是全圆角）。 */
.wd-connectors .category-tabs button[data-category],.wd-connectors .more-btn{padding:6px 12px;border:0;border-radius:9px}
.wd-connectors .category-tabs button[data-category],.wd-connectors .more-btn{background:transparent;color:var(--dsw-alias-label-secondary);white-space:nowrap}
/* 选中＝与悬浮一致的浅灰圆角底 + 深色加粗，未选中＝无底色灰字。
   注意：选中底色必须用 interactive-bg-hover，bg-layer-3 在本主题下几乎与页面底色一致，看不出选中。 */
.wd-connectors .category-tabs button[data-category]:hover,.wd-connectors .more-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-connectors .category-tabs button[data-category].active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.wd-connectors .category-tabs button[hidden],.wd-connectors .more-wrap[hidden],.wd-connectors .more-panel[hidden]{display:none}
.wd-connectors .more-wrap{position:relative;flex:none;display:inline-flex}
.wd-connectors .more-btn{display:inline-flex;align-items:center;gap:5px}
/* 「更多」上的计数＝被折叠且已选中的分类数量，避免选中项被折叠后看不见。 */
.wd-connectors .more-btn .more-count{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:11px;font-style:normal;font-weight:600;line-height:1}
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
.wd-connectors .card{position:relative;display:flex;flex-direction:column;min-width:0;min-height:148px;padding:14px;text-align:left;cursor:pointer}
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
.wd-connectors .card-error{overflow:hidden;margin:8px 0 0;color:#ff746c;font-size:12px;line-height:18px}
.wd-connectors .card-error{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
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
.wd-connectors .plus{display:grid;place-items:center;width:30px;height:30px;padding:0}
.wd-connectors .plus{border:0;border-radius:9px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.wd-connectors .plus:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wd-connectors .plus.installing{cursor:default}
/* 转圈指示器：安装加号与启停开关的加载态共用。 */
.wd-connectors .spinner{width:15px;height:15px;border-radius:50%}
.wd-connectors .spinner{border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:wd-connector-spin .7s linear infinite}
@keyframes wd-connector-spin{to{transform:rotate(360deg)}}
/* 开关槽位：启停期间原地显示加载态，保持开关所在位置不跳动。 */
.wd-connectors .switch-loading{flex:none;display:grid;place-items:center;width:34px;height:34px}
.wd-connectors .installed-pill{flex:none;padding:4px 10px;border-radius:999px}
.wd-connectors .installed-pill{background:var(--dsw-alias-bg-layer-1);color:#55ce63;font-size:12px;font-weight:500}
.wd-connectors .market-foot{display:flex;justify-content:center;padding:22px 0 6px;color:var(--dsw-alias-label-tertiary);font-size:12px}

/* ------------------------------------------------------------ 安装进度条 */
.wd-connectors .install-bar,.connector-detail-dialog .install-bar{position:relative;overflow:hidden;height:3px;margin-top:10px}
.wd-connectors .install-bar,.connector-detail-dialog .install-bar{border-radius:999px;background:var(--dsw-alias-bg-layer-3)}
.wd-connectors .install-bar-fill,.connector-detail-dialog .install-bar-fill{position:absolute;top:0;bottom:0;left:0;width:40%}
.wd-connectors .install-bar-fill,.connector-detail-dialog .install-bar-fill{border-radius:999px;background:var(--dsw-alias-brand-primary);animation:wd-connector-install 1.2s ease-in-out infinite}
@keyframes wd-connector-install{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
.connector-detail-dialog .install-bar{margin:0 0 16px;flex:none}
.wd-connectors .empty{padding:64px 20px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.wd-connectors .empty strong{display:block;margin-bottom:6px}
.wd-connectors .empty strong{color:var(--dsw-alias-label-secondary);font-size:16px}

/* ------------------------------------------------------------ 详情弹窗 */
/* 弹窗自身不滚动：上方信息区（图标、标题、说明、指标）固定，只有下方工具清单滚动，
   工具很多时也不会把标题滚到看不见。 */
.wd-dialog.connector-detail-dialog{width:min(820px,calc(100vw - 40px))}
.wd-dialog.connector-detail-dialog{display:flex;flex-direction:column;overflow:hidden}
.connector-detail-dialog{padding:24px}
.connector-detail-dialog .detail-hero{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:16px;align-items:center;flex:none}
.connector-detail-dialog .detail-hero{padding-right:52px}
.connector-detail-dialog .detail-title{min-width:0}
.connector-detail-dialog .detail-title h1{margin:0 0 4px}
.connector-detail-dialog .detail-title h1{font-size:20px;overflow-wrap:anywhere}
.connector-detail-dialog .detail-actions{display:flex;align-items:center;gap:9px}
.connector-detail-dialog .detail-summary{margin:20px 0;flex:none}
.connector-detail-dialog .detail-summary{color:var(--dsw-alias-label-secondary)}
/* flex-basis 必须留 auto：弹窗高度是内容撑开的，basis 为 0 会让指标区拿不到高度、
   内容直接溢出。留 auto 才能在超出 max-height 时把多余高度压给工具清单去滚动。 */
.connector-detail-dialog .metrics{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;gap:12px;padding:16px}
.connector-detail-dialog .metrics{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.connector-detail-dialog .metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;flex:none}
.connector-detail-dialog .metric small{display:block}
.connector-detail-dialog .metric small{color:var(--dsw-alias-label-tertiary);font-size:12px}
.connector-detail-dialog .metric strong{font-size:15px}
/* 工具清单：表头固定，只有 tool-list-body 滚动，工具很多时「共 N 个」也不动。 */
.connector-detail-dialog .tool-list{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;padding:14px;border-radius:8px}
.connector-detail-dialog .tool-list{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:13px}
.connector-detail-dialog .tool-list-body{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}
.connector-detail-dialog .tool-list-head{flex:none;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.connector-detail-dialog .tool-list-head{color:var(--dsw-alias-label-secondary);font-weight:500}
.connector-detail-dialog .tool-list-head .muted{color:var(--dsw-alias-label-tertiary);font-weight:400}
.connector-detail-dialog .tool-item{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.connector-detail-dialog .tool-item:first-of-type{border-top:0}
.connector-detail-dialog .tool-item-top{display:flex;align-items:baseline;gap:8px}
/* 工具序号：与工具名同色（正文色），固定窄列宽，等宽数字避免工具名左右错位。 */
.connector-detail-dialog .tool-index{flex:none;min-width:16px;color:var(--dsw-alias-label-primary);font-style:normal;font-variant-numeric:tabular-nums}
.connector-detail-dialog .tool-item code{margin:0;overflow-wrap:anywhere}
.connector-detail-dialog .tool-item code,.connector-detail-dialog code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary)}
.connector-detail-dialog .tool-tag{margin-left:auto;padding:1px 8px;border-radius:999px}
.connector-detail-dialog .tool-tag{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px}
.connector-detail-dialog .tool-item p{margin:6px 0 0;color:var(--dsw-alias-label-secondary)}
.connector-detail-dialog .tool-item small{display:block;margin-top:4px}
.connector-detail-dialog .tool-item small,.connector-detail-dialog .tool-empty{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.connector-detail-dialog .tool-empty{margin:12px 0 0}
.connector-detail-dialog .error{flex:none}
.connector-detail-dialog .hint{flex:none;margin:0 0 14px;color:var(--dsw-alias-label-tertiary)}
.connector-detail-dialog .danger,.connector-config-dialog .danger{color:#ff8f89}
/* 市场详情的「已安装」：与卡片上的已安装胶囊同色，和可点击的「安装」区分开。 */
.connector-detail-dialog .installed-action{color:#55ce63}

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
.connector-detail-dialog .metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
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
