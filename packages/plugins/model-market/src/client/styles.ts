/** 模型市场页面的作用域样式；颜色全部取自官方设置主题变量。 */
export const modelMarketCss = `
@layer workdsh-business {
.wd-model-market{height:100%;overflow:auto;box-sizing:border-box;padding:4px 12px 24px;color:var(--dsw-alias-label-primary);font:14px/22px "PingFang SC","Microsoft YaHei",sans-serif}
.wd-model-market *{box-sizing:border-box}
.wd-model-market button,.wd-model-market input,.wd-model-market select{font:inherit;color:inherit}
.wd-model-market button{cursor:pointer}
.wd-model-market button:disabled{cursor:not-allowed;opacity:.55}
.wd-model-market :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* 与官方设置页一致：输入框聚焦时只改变描边颜色，不再叠加外圈 outline。 */
.wd-model-market input:not([type="checkbox"]):focus-visible,.wd-model-market select:focus-visible{outline:none}
.wd-model-market input:not([type="checkbox"]):focus,.wd-model-market select:focus{border-color:var(--dsw-alias-state-business-primary)}

.wd-model-market .mm-head{display:flex;align-items:baseline;gap:10px;margin:0 0 14px}
.wd-model-market .mm-title{margin:0;font-family:var(--dsw-font-family);font-size:18px;line-height:25px;font-weight:600}
.wd-model-market .mm-count{color:var(--dsw-alias-label-tertiary);font-size:12px}
/* 右上角操作组：刷新与添加本地模型并排。 */
.wd-model-market .mm-head-actions{display:flex;align-items:center;align-self:center;gap:8px;margin-left:auto}
.wd-model-market .mm-local{position:relative;margin-bottom:18px}
.wd-model-market .mm-local-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.wd-model-market .mm-group-head{display:inline-flex;align-items:center;gap:6px;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-group-head svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-group-head .mm-section-title{margin:0;font-weight:400}
.wd-model-market .mm-group-head:hover svg{color:var(--dsw-alias-label-secondary)}
.wd-model-market .mm-count-pill{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:1}
.wd-model-market .mm-card-static{cursor:default}

.wd-model-market .mm-tools{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.wd-model-market .mm-search{width:100%;height:36px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-search::placeholder{color:var(--dsw-alias-label-tertiary)}
/* 搜索框与两个筛选条件同排：搜索框缩短并自适应，筛选下拉保持自身宽度。 */
.wd-model-market .mm-tools > .mm-search{flex:1 1 180px;width:auto;min-width:120px;height:32px}
.wd-model-market .mm-filters{display:flex;align-items:center;gap:8px;flex:0 0 auto}
@media (max-width:560px){.wd-model-market .mm-tools{flex-wrap:wrap}}
.wd-model-market .mm-select{height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
/* 第二行状态筛选：技能市场同款胶囊，窄屏自动换行。 */
.wd-model-market .mm-status-filters{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;margin:-6px 0 16px;min-width:0;max-width:100%}
.wd-model-market .mm-filter-group{display:flex;align-items:center;gap:7px;min-width:0;max-width:100%;flex-wrap:wrap}
.wd-model-market .mm-filter-label{flex:none;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.wd-model-market .mm-pills{display:flex;flex-wrap:wrap;gap:2px;min-width:0}
.wd-model-market .mm-pills button{min-height:28px;padding:3px 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer}
.wd-model-market .mm-pills button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-pills button.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.wd-model-market .mm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
/* 模型市场区：覆盖层只罩这一块，标题、搜索与筛选保持可点。 */
.wd-model-market .mm-content{position:relative;min-height:120px}
@media (max-width:560px){.wd-model-market .mm-grid{grid-template-columns:minmax(0,1fr)}}
.wd-model-market .mm-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);text-align:left;cursor:pointer;transition:border-color .12s ease,background .12s ease}
/* 悬停只加边框与浅阴影，不再换底色——换底色会像蒙了一层灰盖住整张卡片。 */
.wd-model-market .mm-card:hover{border-color:var(--dsw-alias-border-l3);box-shadow:0 2px 10px rgba(0,0,0,.06)}
.wd-model-market .mm-card.is-busy{opacity:.72;cursor:progress}
/* 第一块占两行：图标垂直居中跨两行，右侧第一行名称、第二行模型标识。 */
.wd-model-market .mm-card-head{display:flex;align-items:center;gap:10px;min-width:0}
.wd-model-market .mm-card-head-main{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0}
.wd-model-market .mm-icon{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600}
.wd-model-market .mm-icon.lg{width:44px;height:44px;border-radius:11px;font-size:16px}
.wd-model-market .mm-icon img{width:100%;height:100%;object-fit:cover}
.wd-model-market .mm-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}
.wd-model-market .mm-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;height:38px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}
.wd-model-market .mm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:7px}
.wd-model-market .mm-foot-left{display:inline-flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.wd-model-market .mm-card-actions{display:inline-flex;align-items:center;gap:8px;flex:none}
/* 市场卡片：操作按钮独立成行并右对齐（本地卡片仍沿用行内布局）。 */
.wd-model-market .mm-card-actions.is-row{display:flex;justify-content:flex-end;flex-wrap:wrap}
/* 规格项：字段名直接展示在胶囊前，不再依赖悬浮提示。 */
.wd-model-market .mm-spec{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.wd-model-market .mm-spec-label{font-weight:400}
.wd-model-market .mm-state{display:inline-flex;align-items:center;flex:none;height:20px;padding:0 5px;border:1px solid #d9d9d9;border-radius:4px;background:#f5f5f5;color:#434343;font-size:12px;line-height:18px;white-space:nowrap}
.wd-model-market .mm-state.on{background:#f6ffed;border-color:#b7eb8f;color:#389e0d}
/* 状态/分类标签：与技能市场 a-tag 同规格，配色由面板按字典逐项注入。 */
.wd-model-market .mm-tag{display:inline-flex;align-items:center;gap:4px;flex:none;height:20px;padding:0 5px;border:1px solid transparent;border-radius:4px;font-size:12px;line-height:18px;font-weight:400;white-space:nowrap}
.wd-model-market .mm-tag-dot{flex:none;width:6px;height:6px;border-radius:50%}
/* 数值标签的字段名提示：CSS 伪元素即时显示，不依赖原生 title（延迟长、样式由系统决定）。 */
.wd-model-market .mm-tip{position:relative}
.wd-model-market .mm-tip::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;z-index:30;padding:3px 8px;border-radius:6px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);font-size:11px;line-height:16px;font-weight:400;white-space:nowrap;transform:translateX(-50%);opacity:0;pointer-events:none;transition:opacity .12s ease}
.wd-model-market .mm-tip:hover::after{opacity:1}
/* 引用式小标题：左侧竖线 + 灰色常规字重，比加粗标题更轻。 */
.wd-model-market .mm-quote{padding:2px 0 2px 10px;border-left:3px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:400}
.wd-model-market .mm-reasoning-table .mm-quote{margin-bottom:8px}
.wd-model-market .mm-action{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:none;min-width:58px;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:26px;font-weight:400;white-space:nowrap}
.wd-model-market .mm-action:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3)}
/* 主操作沿用技能市场的黑色主按钮；编辑、添加本地模型都用它，移除用 800000 实心红。 */
.wd-model-market .mm-action.install,.wd-model-market .mm-action.primary{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);font-weight:600}
.wd-model-market .mm-action.install:hover:not(:disabled),.wd-model-market .mm-action.primary:hover:not(:disabled){background:#43454a;color:var(--dsw-alias-label-primary-inverted)}
.wd-model-market .mm-action.uninstall{border-color:#800000;background:#800000;color:#fff;font-weight:600}
.wd-model-market .mm-action.uninstall:hover:not(:disabled){border-color:#800000;background:#800000;color:#fff;opacity:.88}
/* 刷新复用 .mm-action 的盒模型（高度/内边距/圆角/字号/边框全部同源），只把配色换成白底黑字。 */
.wd-model-market .mm-refresh{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.wd-model-market .mm-refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wd-model-market .mm-refresh:disabled{color:var(--dsw-alias-label-dimmed)}
.wd-model-market .mm-spinner{flex:none;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:wd-mm-spin .7s linear infinite}
@keyframes wd-mm-spin{to{transform:rotate(360deg)}}
.wd-model-market .mm-card-confirm{display:flex;align-items:center;gap:6px;padding:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:12px}
.wd-model-market .mm-card-confirm span{min-width:0;margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-model-market .mm-card-confirm button{flex:none;white-space:nowrap;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:400}
.wd-model-market .mm-card-confirm button.danger{border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary);color:#fff}

/* 页面级提示吸顶：长页面滚动到任何位置操作时，错误/成功信息都保持可见。 */
.wd-model-market .mm-banners{position:sticky;top:0;z-index:20;display:flex;flex-direction:column;gap:4px;margin:0 0 12px;padding:8px 0;background:var(--dsw-alias-bg-layer-2)}
.wd-model-market .mm-banners .mm-error,.wd-model-market .mm-banners .mm-notice{margin:0}
.wd-model-market .mm-error,.wd-model-market .mm-notice{margin:0 0 12px;font-size:13px}
.wd-model-market .mm-error{color:#ff746c}
.wd-model-market .mm-notice{color:#55ce63}
.wd-model-market .mm-loading,.wd-model-market .mm-empty{padding:36px 12px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-empty strong{display:block;margin-bottom:6px;color:var(--dsw-alias-label-secondary);font-weight:500}
.wd-model-market .mm-pager{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:18px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-model-market .mm-pager button{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400}

.wd-model-market .mm-back{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;font-weight:400}
.wd-model-market .mm-back:hover{color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-back svg{flex:none}
.wd-model-market .mm-detail{display:flex;flex-direction:column;gap:14px}
.wd-model-market .mm-detail-head{display:flex;align-items:center;gap:12px;min-width:0}
.wd-model-market .mm-detail-main{display:flex;flex-direction:column;gap:7px;flex:1 1 auto;min-width:0}
.wd-model-market .mm-detail-title-row{display:flex;align-items:center;gap:8px;min-width:0}
.wd-model-market .mm-detail-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;line-height:28px;font-weight:600}
.wd-model-market .mm-detail-action{margin-left:auto;flex:none}
.wd-model-market .mm-detail-desc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:21px;white-space:pre-wrap;word-break:break-word}
.wd-model-market .mm-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.wd-model-market .mm-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}
@media (max-width:560px){.wd-model-market .mm-info-grid{grid-template-columns:minmax(0,1fr)}}
.wd-model-market .mm-info{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px}
.wd-model-market .mm-info .k{flex:none;color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-info .v{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-section-title{margin:0 0 8px;font-size:13px;font-weight:600}
.wd-model-market .mm-block{padding:11px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}
.wd-model-market .mm-block dl{display:grid;grid-template-columns:68px minmax(0,1fr);gap:4px 10px;margin:0}
.wd-model-market .mm-block dt{color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-block dd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0;color:var(--dsw-alias-label-primary)}
/* 推理等级表：列宽固定，只有「推理等级描述」吃剩余宽度，不随数据长短跳动。 */
.wd-model-market .mm-reasoning-table{display:flex;flex-direction:column;min-width:0;overflow-x:auto}
.wd-model-market .mm-reasoning-table table{width:100%;min-width:460px;table-layout:fixed;border-collapse:collapse;font-size:12px}
.wd-model-market .mm-reasoning-table .col-tier{width:88px}
.wd-model-market .mm-reasoning-table .col-wire{width:120px}
.wd-model-market .mm-reasoning-table .col-rate{width:96px}
.wd-model-market .mm-reasoning-table th,.wd-model-market .mm-reasoning-table td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--dsw-alias-border-l2);word-break:break-word}
.wd-model-market .mm-reasoning-table th{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-weight:400;white-space:nowrap}
.wd-model-market .mm-reasoning-table td{color:var(--dsw-alias-label-secondary);line-height:19px}
.wd-model-market .mm-reasoning-table th:last-child,.wd-model-market .mm-reasoning-table td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.wd-model-market .mm-reasoning-table td:first-child{color:var(--dsw-alias-label-primary);font-family:ui-monospace,"SF Mono",Menlo,monospace}
.wd-model-market .mm-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid #ff746c;border-radius:10px;color:#ff746c;font-size:12px}
.wd-model-market .mm-confirm button{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:400}
.wd-model-market .mm-confirm button.danger{border-color:#ff746c;background:#ff746c;color:#fff}
.wd-model-market .mm-hint{color:var(--dsw-alias-label-tertiary);font-size:12px}

/* ------------------------------------------------------------ 自定义模型表单 */
.wd-model-market .mm-custom-form{display:flex;flex-direction:column;gap:14px;min-width:0}
.wd-model-market .mm-form-section{display:flex;flex-direction:column;gap:12px;min-width:0}
.wd-model-market .mm-form-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.wd-model-market .mm-field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.wd-model-market .mm-field > span{font-weight:500;color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-field input,.wd-model-market .mm-field select{width:100%;min-width:0;max-width:100%;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-field input::placeholder{color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-field small{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.wd-model-market .mm-model-list{display:flex;flex-direction:column;gap:8px}
.wd-model-market .mm-model-row{display:flex;flex-direction:column;min-width:0;padding:6px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg)}
.wd-model-market .mm-model-row-head{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto auto;gap:6px;align-items:center}
.wd-model-market .mm-model-id,.wd-model-market .mm-model-name{box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.wd-model-market .mm-model-id::placeholder,.wd-model-market .mm-model-name::placeholder{color:var(--dsw-alias-label-dimmed)}
.wd-model-market .mm-model-toggle{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-model-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-remove-model{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-remove-model:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.wd-model-market .mm-add-model{align-self:flex-start;display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-weight:400}
.wd-model-market .mm-add-model:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-model-market .mm-discover-trigger{display:inline-flex;align-items:center;gap:4px;padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:400;white-space:nowrap}
.wd-model-market .mm-discover{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.wd-model-market .mm-discover-tools{display:flex;align-items:center;gap:8px}
.wd-model-market .mm-discover-tools .mm-search{flex:1;min-width:0;height:30px}
.wd-model-market .mm-discover-link{padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:400;white-space:nowrap}
.wd-model-market .mm-discover-list{display:flex;flex-direction:column;max-height:220px;overflow:auto}
.wd-model-market .mm-discover-item{display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}
.wd-model-market .mm-discover-item:last-child{border-bottom:0}
.wd-model-market .mm-discover-name{flex:none;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.wd-model-market .mm-discover-meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,"SF Mono",Menlo,monospace}
.wd-model-market .mm-discover-actions{display:flex;justify-content:flex-end;gap:8px}
.wd-model-market .mm-discover-actions .mm-action{height:28px;min-width:70px}
.wd-model-market .mm-model-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:8px 4px 2px;min-width:0}
@media (max-width:560px){.wd-model-market .mm-model-grid{grid-template-columns:minmax(0,1fr)}}
.wd-model-market .mm-model-grid .mm-field{gap:4px}
.wd-model-market .mm-model-grid .mm-field > span{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.wd-model-market .mm-model-grid .mm-field input{height:32px;border-width:.5px;border-color:var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);font-size:14px;line-height:22px}
.wd-model-market .mm-input-types{grid-column:1/-1;min-width:0;margin:0;padding:0;border:0}
.wd-model-market .mm-field-label{display:block;margin:0 0 4px;padding:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.wd-model-market .mm-check-group{display:flex;align-items:center;flex-wrap:wrap;gap:16px;min-height:32px}
.wd-model-market .mm-checkbox{display:inline-flex;align-items:center;gap:6px;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}
.wd-model-market .mm-checkbox input{flex:0 0 auto;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:inherit}
.wd-model-market .mm-checkbox:has(input:disabled){cursor:default;opacity:.5}
.wd-model-market .mm-reasoning{grid-column:1/-1;display:flex;flex-direction:column;gap:6px;min-width:0}
.wd-model-market .mm-reasoning-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.wd-model-market .mm-reasoning-label{display:inline-flex;align-items:center;gap:6px}
.wd-model-market .mm-reasoning-label .mm-field-label{margin:0}
.wd-model-market .mm-help-wrap{position:relative;display:inline-flex;align-items:center}
.wd-model-market .mm-help{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;cursor:help}
.wd-model-market .mm-help:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-tooltip{position:absolute;top:calc(100% + 8px);left:-6px;z-index:30;display:none;width:320px;max-width:min(320px,72vw);padding:8px 10px;border-radius:8px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);font-size:12px;line-height:18px;font-weight:400;text-align:left;white-space:normal;box-shadow:0 4px 16px rgba(0,0,0,.16);pointer-events:none}
.wd-model-market .mm-help-wrap:hover .mm-tooltip,.wd-model-market .mm-help-wrap:focus-within .mm-tooltip{display:block}
.wd-model-market .mm-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l4);cursor:pointer;transition:background .15s}
.wd-model-market .mm-switch.on{background:var(--dsw-alias-brand-primary)}
.wd-model-market .mm-switch-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:transform .15s}
.wd-model-market .mm-switch.on .mm-switch-thumb{transform:translateX(16px)}
.wd-model-market .mm-reasoning-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;align-items:center;gap:6px}
.wd-model-market .mm-reasoning-columns{align-items:end}
.wd-model-market .mm-reasoning-select,.wd-model-market .mm-reasoning-value{box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.wd-model-market .mm-reasoning-select{appearance:none;cursor:pointer;padding-right:32px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-position:right 12px center;background-repeat:no-repeat;background-size:12px 12px}
.wd-model-market .mm-reasoning-value{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:13px}
.wd-model-market .mm-reasoning-value::placeholder{color:var(--dsw-alias-label-dimmed)}
.wd-model-market .mm-reasoning-value:disabled{opacity:.6;cursor:default}
.wd-model-market .mm-reasoning-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.wd-model-market .mm-form-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}
.wd-model-market .mm-form-actions .mm-action{height:32px;min-width:80px}

/* ------------------------------------------------------------ 自定义模型弹窗
   添加 / 编辑本地模型统一在设置面板上层弹窗：遮罩盖住整窗，弹窗居中，
   关闭后设置仍停在模型管理列表。 */
.mm-modal-mask{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;background:var(--dsw-alias-bg-mask-2,rgba(0,0,0,.32));animation:wd-mm-mask-in .12s ease-out}
.mm-modal{display:flex;flex-direction:column;box-sizing:border-box;width:min(760px,100%);max-height:min(84vh,760px);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-base);box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden}
.mm-modal *{box-sizing:border-box}
.mm-modal-head{display:flex;align-items:center;gap:12px;flex:none;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.mm-modal-title{font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
.mm-modal-close{display:grid;place-items:center;flex:none;width:28px;height:28px;margin-left:auto;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.mm-modal-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mm-modal-close:disabled{cursor:not-allowed;opacity:.55}
.mm-modal-body{flex:1 1 auto;min-height:0;padding:14px 16px 16px;overflow:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)}
/* 弹窗自带标题与关闭按钮：隐藏表单内部的「返回模型列表」，底部仍有取消。 */
.mm-modal-body .wd-model-market{height:auto;padding:0;overflow:visible}
.mm-modal-body .mm-back{display:none}
@keyframes wd-mm-mask-in{from{opacity:0}to{opacity:1}}
@media (max-width:560px){.mm-modal-mask{padding:10px}.mm-modal{max-height:calc(100vh - 20px)}}
}
`;
