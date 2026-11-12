/**
 * 卡片加载占位样式；宿主页面只负责外围网格，占位卡按 `variant` 贴合各自真实卡片。
 *
 * - `compact`：技能页的卡片（与技能市场卡同高：图标 + 名称/标识两行 + 右下操作位）；
 * - `tile` / `avatar` / `model`：连接器、专家、模型市场的卡片，尺寸与真实卡片同高。
 */
export const cardSkeletonCss = `
.wd-card-skeleton{position:relative;box-sizing:border-box;display:flex;align-items:flex-start;gap:14px;min-height:189px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-layer-2)}
.wd-card-skeleton-mark{width:46px;height:46px;flex:none;border-radius:50%;background:#f2f3f5}
.wd-card-skeleton-body{display:flex;flex:1;flex-direction:column;gap:8px;min-width:0;padding:4px 56px 0 0}
.wd-card-skeleton-line{display:block;height:10px;border-radius:5px;background:#eceef1}
.wd-card-skeleton-line.title{width:62%;height:12px}
.wd-card-skeleton-line.sub{width:42%;height:9px}
.wd-card-skeleton-action{position:absolute;bottom:14px;right:14px;width:58px;height:28px;border-radius:6px;background:#f2f3f5}
/* 多行卡片：图标 + 标题/副标题 + 两行说明 + 底部状态/按钮位。 */
.wd-card-skeleton.v-tile,.wd-card-skeleton.v-avatar,.wd-card-skeleton.v-model{display:flex;flex-direction:column;align-items:stretch}
.wd-card-skeleton.v-tile{min-height:148px;padding:14px;gap:10px;border-radius:18px}
.wd-card-skeleton.v-avatar{min-height:150px;padding:24px;gap:12px;border-radius:17px}
.wd-card-skeleton.v-model{min-height:126px;padding:12px;gap:8px;border-radius:14px}
.wd-card-skeleton-top{display:flex;align-items:center;gap:14px;min-width:0}
.wd-card-skeleton.v-avatar .wd-card-skeleton-top{align-items:flex-start;gap:12px}
.wd-card-skeleton.v-model .wd-card-skeleton-top{gap:9px}
.wd-card-skeleton-lines{display:flex;flex:1;flex-direction:column;gap:7px;min-width:0}
.wd-card-skeleton.v-tile .wd-card-skeleton-mark{width:46px;height:46px;border-radius:13px}
.wd-card-skeleton.v-avatar .wd-card-skeleton-mark{width:46px;height:46px;border-radius:50%}
.wd-card-skeleton.v-model .wd-card-skeleton-mark{width:34px;height:34px;border-radius:9px}
.wd-card-skeleton-line.desc{width:100%;height:9px}
.wd-card-skeleton-line.desc.short{width:64%}
.wd-card-skeleton.v-model .wd-card-skeleton-line.title{width:52%}
.wd-card-skeleton.v-model .wd-card-skeleton-line.sub{width:38%;height:8px}
.wd-card-skeleton-tags{display:flex;gap:6px;padding-top:2px}
.wd-card-skeleton-tags span{display:block;width:42px;height:16px;border-radius:4px;background:#f2f3f5}
.wd-card-skeleton-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:6px}
.wd-card-skeleton-foot span{display:block;width:48px;height:16px;border-radius:999px;background:#f2f3f5}
.wd-card-skeleton-foot span:last-child{width:34px}
.wd-card-skeleton-mark,.wd-card-skeleton-line,.wd-card-skeleton-action,.wd-card-skeleton-tags span,.wd-card-skeleton-foot span{opacity:.75;animation:wd-card-skeleton-pulse 2.4s ease-in-out infinite}
@keyframes wd-card-skeleton-pulse{0%,100%{opacity:.55}50%{opacity:.9}}
@media(prefers-reduced-motion:reduce){.wd-card-skeleton-mark,.wd-card-skeleton-line,.wd-card-skeleton-action,.wd-card-skeleton-tags span,.wd-card-skeleton-foot span{animation:none;opacity:.75}}
`;
