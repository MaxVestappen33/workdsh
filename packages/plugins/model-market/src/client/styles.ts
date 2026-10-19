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
.wd-model-market .mm-head-add{margin-left:auto}
.wd-model-market .mm-local{margin-bottom:18px}
.wd-model-market .mm-local-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.wd-model-market .mm-group-head{display:inline-flex;align-items:center;gap:6px;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-group-head svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.wd-model-market .mm-group-head .mm-section-title{margin:0}
.wd-model-market .mm-group-head:hover svg{color:var(--dsw-alias-label-secondary)}
.wd-model-market .mm-count-pill{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:1}
.wd-model-market .mm-card-static{cursor:default}

.wd-model-market .mm-tools{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.wd-model-market .mm-search{width:100%;height:36px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-search::placeholder{color:var(--dsw-alias-label-tertiary)}
/* 搜索框与两个筛选条件同排：搜索框缩短并自适应，筛选下拉保持自身宽度。 */
.wd-model-market .mm-tools > .mm-search{flex:1 1 180px;width:auto;min-width:120px;height:32px}
.wd-model-market .mm-filters{display:flex;align-items:center;gap:8px;flex:0 0 auto}
@media (max-width:560px){.wd-model-market .mm-tools{flex-wrap:wrap}}
.wd-model-market .mm-select{height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.wd-model-market .mm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (max-width:560px){.wd-model-market .mm-grid{grid-template-columns:minmax(0,1fr)}}
.wd-model-market .mm-card{display:flex;flex-direction:column;gap:7px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);text-align:left;cursor:pointer;transition:border-color .12s ease,background .12s ease}
.wd-model-market .mm-card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
.wd-model-market .mm-card.is-busy{opacity:.72;cursor:progress}
.wd-model-market .mm-card-top{display:flex;align-items:center;gap:9px;min-width:0}
.wd-model-market .mm-card-top > div{flex:1 1 auto;min-width:0}
.wd-model-market .mm-source{flex:none;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;white-space:nowrap}
.wd-model-market .mm-source.custom{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}
.wd-model-market .mm-icon{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600}
.wd-model-market .mm-icon.lg{width:44px;height:44px;border-radius:11px;font-size:16px}
.wd-model-market .mm-icon img{width:100%;height:100%;object-fit:cover}
.wd-model-market .mm-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}
.wd-model-market .mm-version{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px}
.wd-model-market .mm-meta{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}
.wd-model-market .mm-meta-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-model-market .mm-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;height:38px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}
.wd-model-market .mm-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:7px}
.wd-model-market .mm-foot-left{display:inline-flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.wd-model-market .mm-card-actions{display:inline-flex;align-items:center;gap:8px;flex:none}
.wd-model-market .mm-context{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-model-market .mm-state{display:inline-flex;align-items:center;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap}
.wd-model-market .mm-state.on{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary);font-weight:600}
.wd-model-market .mm-badge{display:inline-flex;align-items:center;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;white-space:nowrap}
.wd-model-market .mm-badge.default{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.wd-model-market .mm-action{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:none;min-width:58px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-brand-primary);border-radius:999px;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:600;white-space:nowrap}
.wd-model-market .mm-action.install{background:var(--dsw-alias-brand-primary);color:#fff}
.wd-model-market .mm-action.uninstall{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);color:var(--dsw-alias-state-error-primary)}
.wd-model-market .mm-action.uninstall:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.wd-model-market .mm-spinner{flex:none;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:wd-mm-spin .7s linear infinite}
@keyframes wd-mm-spin{to{transform:rotate(360deg)}}
.wd-model-market .mm-card-confirm{display:flex;align-items:center;gap:6px;padding:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:12px}
.wd-model-market .mm-card-confirm span{min-width:0;margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-model-market .mm-card-confirm button{flex:none;white-space:nowrap;height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px}
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
.wd-model-market .mm-pager button{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px}

.wd-model-market .mm-back{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;font-weight:400}
.wd-model-market .mm-back:hover{color:var(--dsw-alias-label-primary)}
.wd-model-market .mm-back svg{flex:none}
.wd-model-market .mm-detail{display:flex;flex-direction:column;gap:14px}
.wd-model-market .mm-detail-head{display:flex;align-items:center;gap:12px;min-width:0}
.wd-model-market .mm-detail-title-row{display:flex;align-items:center;gap:8px;min-width:0}
.wd-model-market .mm-detail-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:20px;line-height:28px;font-weight:600}
.wd-model-market .mm-detail-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-model-market .mm-detail-action{margin-left:auto;flex:none}
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
.wd-model-market .mm-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid #ff746c;border-radius:10px;color:#ff746c;font-size:12px}
.wd-model-market .mm-confirm button{height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px}
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
.wd-model-market .mm-add-model{align-self:flex-start;display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.wd-model-market .mm-add-model:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-model-market .mm-discover-trigger{display:inline-flex;align-items:center;gap:4px;padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:500;white-space:nowrap}
.wd-model-market .mm-discover{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.wd-model-market .mm-discover-tools{display:flex;align-items:center;gap:8px}
.wd-model-market .mm-discover-tools .mm-search{flex:1;min-width:0;height:30px}
.wd-model-market .mm-discover-link{padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:500;white-space:nowrap}
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
.wd-model-market .mm-form-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}
.wd-model-market .mm-form-actions .mm-action{height:32px;min-width:80px}
}
`;
