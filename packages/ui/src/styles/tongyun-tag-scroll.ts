/**
 * TongyunTagScrollRow 样式：标签单行排布，溢出时出现左右翻页箭头与两端渐隐遮罩。
 * 类名统一以 `wd-tagrow` 前缀限定（沿用旧前缀以减小改动面，对外以组件名为准），
 * 默认灰色直接取主题变量，不污染其他页面。
 */
export const tongyunTagScrollCss = `
.wd-tagrow{position:relative;display:flex;align-items:center;gap:0;width:100%;max-width:100%;min-width:0}
.wd-tagrow .wd-tagrow-nav{position:absolute;top:50%;z-index:2;transform:translateY(-50%);display:none;flex:0 0 auto;align-items:center;justify-content:center;box-sizing:border-box;width:24px;height:24px;min-height:0;min-width:0;padding:0;margin:0;border:1px solid rgba(17,24,39,.12);border-radius:50%;background:rgba(255,255,255,.42);color:rgba(55,65,81,.72);cursor:pointer;opacity:0;visibility:hidden;box-shadow:0 1px 3px rgba(16,24,40,.10);transition:opacity .15s ease,background .18s ease,border-color .18s ease,color .18s ease,box-shadow .18s ease,transform .18s ease}
.wd-tagrow .wd-tagrow-nav--prev{left:0}
.wd-tagrow .wd-tagrow-nav--next{right:0}
.wd-tagrow.is-overflowing .wd-tagrow-nav{display:inline-flex}
.wd-tagrow.is-overflowing.can-prev .wd-tagrow-nav--prev,.wd-tagrow.is-overflowing.can-next .wd-tagrow-nav--next{opacity:1;visibility:visible}
.wd-tagrow.is-overflowing .wd-tagrow-nav:hover{background:var(--dsw-alias-bg-layer-1,#fff);border-color:rgba(17,24,39,.14);color:var(--dsw-alias-label-secondary,#374151);box-shadow:0 2px 8px rgba(16,24,40,.18);transform:translateY(-50%) scale(1.08)}
.wd-tagrow.is-overflowing .wd-tagrow-nav:active{background:var(--dsw-alias-bg-layer-2,#f3f4f6);transform:translateY(-50%) scale(.96)}
.wd-tagrow .wd-tagrow-nav svg{display:block;width:11px;height:11px}
.wd-tagrow-viewport{flex:1 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior-x:contain}
.wd-tagrow-viewport::-webkit-scrollbar{display:none}
.wd-tagrow.is-overflowing .wd-tagrow-viewport{cursor:grab}
.wd-tagrow.is-dragging .wd-tagrow-viewport{cursor:grabbing}
.wd-tagrow.is-dragging{user-select:none;-webkit-user-select:none}
.wd-tagrow-track{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;width:max-content}
.wd-tagrow[data-fade="right"] .wd-tagrow-viewport{-webkit-mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 28px),transparent 100%);mask-image:linear-gradient(90deg,#000 0,#000 calc(100% - 28px),transparent 100%)}
.wd-tagrow[data-fade="left"] .wd-tagrow-viewport{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 28px,#000 100%);mask-image:linear-gradient(90deg,transparent 0,#000 28px,#000 100%)}
.wd-tagrow[data-fade="both"] .wd-tagrow-viewport{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%)}
.wd-tagrow-tag{flex:0 0 auto;display:inline-flex;align-items:center;height:28px;padding:0 10px;border:1px solid var(--wd-tag-border,var(--dsw-alias-border-l2,#e3e6eb));border-radius:8px;background:var(--wd-tag-bg,var(--dsw-alias-bg-layer-3,#f4f5f7));color:var(--wd-tag-text,var(--dsw-alias-label-secondary,#4b5563));font-size:12.5px;line-height:1;white-space:nowrap;transition:background .2s ease,border-color .2s ease,color .2s ease}
`;
