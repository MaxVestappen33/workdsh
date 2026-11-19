/**
 * 会话模型选择器样式。
 *
 * 全部颜色取自官方主题变量，明暗主题跟随宿主；尺寸按产品参考图对齐：
 * 左列 348px（档位 + 模型列表），右列 260px（悬停详情，border-box），两列紧贴、零间隙。
 */
export const modelSelectCss = `
@layer workdsh-business {
.wd-ms-trigger,.wd-ms-trigger *,.wd-ms-pop,.wd-ms-pop *{box-sizing:border-box}
.wd-ms-trigger{display:inline-flex;align-items:center;gap:6px;max-width:220px;height:28px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer;transition:background .12s ease,color .12s ease}
.wd-ms-trigger:hover,.wd-ms-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-ms-trigger:disabled{opacity:.5;cursor:not-allowed}
.wd-ms-trigger-icon{display:var(--dsh-composer-model-icon-display,inline-flex);align-items:center;justify-content:center;flex:none;width:20px;height:20px;color:currentColor}
.wd-ms-trigger-icon > svg{width:15px;height:15px}
.wd-ms-trigger-text{display:var(--dsh-composer-model-text-display,block);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-ms-trigger-caret{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary)}
.wd-ms-trigger-caret svg{width:12px;height:12px}

.wd-ms-pop{position:fixed;z-index:2147482000;display:flex;align-items:flex-start;gap:8px;font:13px/20px var(--dsw-font-family);color:var(--dsw-alias-label-primary);animation:wd-ms-in .12s ease-out}
@keyframes wd-ms-in{from{opacity:0;transform:translateY(4px) scale(.995)}to{opacity:1;transform:none}}

.wd-ms-main{display:flex;flex-direction:column;width:348px;max-width:calc(100vw - 16px);min-height:0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 44px rgba(0,0,0,.18),0 2px 10px rgba(0,0,0,.08);overflow:hidden}
.wd-ms-top{flex:none;padding:6px 6px 0}
.wd-ms-scroll-wrap{position:relative;display:flex;flex:1 1 auto;min-height:0}
.wd-ms-scroll{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 6px 6px}
.wd-ms-fade{position:absolute;top:0;left:0;right:0;height:14px;background:linear-gradient(var(--dsw-alias-bg-base),transparent);opacity:0;pointer-events:none;transition:opacity .12s ease}
.wd-ms-fade.is-on{opacity:1}
.wd-ms-scroll::-webkit-scrollbar{width:8px}
.wd-ms-scroll::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:8px;background:var(--dsw-alias-border-l3);background-clip:content-box}
.wd-ms-scroll::-webkit-scrollbar-track{background:transparent}

.wd-ms-row{display:flex;align-items:center;gap:10px;width:100%;min-height:36px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.wd-ms-row:hover,.wd-ms-row.is-active{background:var(--dsw-alias-interactive-bg-hover)}
.wd-ms-row.is-busy{cursor:progress}
.wd-ms-row:disabled{opacity:.55;cursor:not-allowed}
/* Auto 与三档暂为纯展示：整行灰字，无 hover 高亮、无选中态；点击只打开介绍面板。 */
.wd-ms-row.is-static{color:var(--dsw-alias-label-tertiary)}
.wd-ms-row.is-static:hover{background:transparent}
.wd-ms-row.is-static .wd-ms-name{color:var(--dsw-alias-label-tertiary)}
.wd-ms-row .wd-ms-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.wd-ms-row.is-selected .wd-ms-name{font-weight:500}

.wd-ms-glyph{flex:none;display:grid;place-items:center;width:20px;height:20px;color:var(--dsw-alias-label-secondary)}
.wd-ms-glyph svg{width:16px;height:16px}
.wd-ms-model-glyph{flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600;line-height:1;letter-spacing:0}
.wd-ms-model-glyph[data-family="deepseek"]{background:color-mix(in srgb,#4d6bfe 14%,transparent);color:#4d6bfe}
.wd-ms-model-glyph[data-family="glm"]{background:color-mix(in srgb,#1f2329 12%,transparent);color:var(--dsw-alias-label-primary)}
.wd-ms-model-glyph[data-family="kimi"]{background:color-mix(in srgb,#1f2329 12%,transparent);color:var(--dsw-alias-label-primary)}
.wd-ms-model-glyph[data-family="seed"]{background:color-mix(in srgb,#1664ff 12%,transparent);color:#1664ff}
.wd-ms-model-glyph[data-family="hy"]{background:color-mix(in srgb,#0f9d58 12%,transparent);color:#0f9d58}
.wd-ms-model-glyph[data-family="minimax"]{background:color-mix(in srgb,#7c3aed 12%,transparent);color:#7c3aed}
.wd-ms-model-glyph[data-family="step"]{background:color-mix(in srgb,#0891b2 12%,transparent);color:#0891b2}
.wd-ms-model-glyph[data-family="mimo"]{background:color-mix(in srgb,#ea580c 12%,transparent);color:#ea580c}

.wd-ms-tag{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 5px;border-radius:4px;font-size:11px;line-height:18px;white-space:nowrap}
.wd-ms-tag[data-tone="green"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}
.wd-ms-tag[data-tone="orange"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}
.wd-ms-tag[data-tone="gray"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}
.wd-ms-tag[data-tone="blue"]{background:color-mix(in srgb,var(--dsw-alias-business-primary) 12%,transparent);color:var(--dsw-alias-business-primary)}

/* 倍率列固定右对齐、占据固定宽度：名字长短、徽标有无都不再影响它的位置。 */
.wd-ms-mult{margin-left:auto;flex:none;min-width:44px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
/* 勾选列固定在最右端并始终占位（未选中为空），选中图标用绿色。 */
.wd-ms-check{flex:none;display:grid;place-items:center;width:18px;height:16px;color:var(--dsw-alias-state-success-primary)}
.wd-ms-check svg{width:14px;height:14px}

.wd-ms-sep{height:1px;margin:6px 10px;background:var(--dsw-alias-border-l2)}
.wd-ms-auto-desc{margin:0;padding:2px 16px 14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.wd-ms-group{display:flex;align-items:center;gap:6px;padding:10px 12px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.wd-ms-group svg{width:13px;height:13px}
.wd-ms-group-count{margin-left:auto;font-variant-numeric:tabular-nums}

.wd-ms-footer{flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:4px 6px}
.wd-ms-footer .wd-ms-row{min-height:38px}
.wd-ms-footer .wd-ms-name{color:var(--dsw-alias-label-secondary)}

.wd-ms-aside{position:fixed;z-index:2147482001;box-sizing:border-box;display:flex;flex-direction:column;width:260px;max-width:calc(100vw - 16px);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-base);box-shadow:0 14px 44px rgba(0,0,0,.18),0 2px 10px rgba(0,0,0,.08);padding:14px 16px 12px;overflow:auto}
.wd-ms-aside-title{margin:0;font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.wd-ms-aside-desc{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.wd-ms-kv{display:flex;align-items:center;gap:12px;min-height:34px;padding:6px 0}
.wd-ms-kv + .wd-ms-kv{border-top:1px solid var(--dsw-alias-border-l2)}
.wd-ms-kv-label{flex:none;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.wd-ms-kv-value{margin-left:auto;display:inline-flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:right}
.wd-ms-kv-value.is-clickable{border:0;background:transparent;font:inherit;font-size:12px;line-height:18px;cursor:pointer;padding:2px 0;border-radius:6px}
.wd-ms-kv-value.is-clickable:hover{color:var(--dsw-alias-label-primary)}
.wd-ms-kv-value svg{width:12px;height:12px;flex:none}
.wd-ms-busy{display:inline-flex;align-items:center;gap:6px}
.wd-ms-busy[data-level="idle"]{color:var(--dsw-alias-label-tertiary)}
.wd-ms-busy[data-level="light"]{color:var(--dsw-alias-state-warn-primary)}
.wd-ms-busy[data-level="heavy"]{color:var(--dsw-alias-state-error-primary)}
.wd-ms-dot{flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}
.wd-ms-note{margin:10px 0 0;padding:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
.wd-ms-menu{margin:6px -4px 0;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.wd-ms-menu button{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.wd-ms-menu button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-ms-menu button[aria-checked="true"]{color:var(--dsw-alias-brand-primary)}
.wd-ms-menu em{margin-left:auto;font-style:normal;color:var(--dsw-alias-label-tertiary)}

.wd-ms-switch{position:relative;flex:none;margin-left:auto;width:34px;height:20px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background .15s ease}
.wd-ms-switch[data-on]{background:var(--dsw-alias-brand-primary)}
.wd-ms-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s ease}
.wd-ms-switch[data-on]::after{transform:translateX(14px)}
.wd-ms-switch:disabled{opacity:.5;cursor:not-allowed}
.wd-ms-spinner{display:block;width:13px;height:13px;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:wd-ms-spin .8s linear infinite}
@keyframes wd-ms-spin{to{transform:rotate(360deg)}}

.wd-ms-state{display:grid;place-items:center;gap:8px;padding:28px 16px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}
.wd-ms-state button{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.wd-ms-state button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wd-ms-error{margin:6px 10px 0;padding:6px 8px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:17px}

@media (max-width:560px){
.wd-ms-main{width:calc(100vw - 16px)}
/* 二级面板在 <720px 时本就不渲染，这里不再放大宽度，避免出现「面板占满整屏」的观感。 */
}
}
`;
