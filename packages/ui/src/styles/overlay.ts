/**
 * 查询中覆盖层的共享样式：四点指示 + 灰色文案 + 浅遮罩。
 *
 * 不绑定具体页面：调用方把覆盖层放进自己的内容容器（`position:relative`）即可，
 * 覆盖层只罩住这块内容区，顶部筛选与按钮保持可点。
 */
export const queryOverlayCss = `
.wd-query-overlay{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;border-radius:12px;background:rgba(255,255,255,.6);color:#8c8c8c;font-size:13px;backdrop-filter:blur(1px)}
.wd-query-dots{display:grid;grid-template-columns:repeat(2,9px);grid-template-rows:repeat(2,9px);gap:6px}
.wd-query-dots i{display:block;width:9px;height:9px;border-radius:50%;background:#1677ff;animation:wd-query-dot 1.2s ease-in-out infinite}
.wd-query-dots i:nth-child(2){background:#91caff;animation-delay:.3s}
.wd-query-dots i:nth-child(3){background:#1677ff;animation-delay:.9s}
.wd-query-dots i:nth-child(4){background:#91caff;animation-delay:.6s}
@keyframes wd-query-dot{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.wd-query-dots i{animation:none;opacity:.8}}
`;
