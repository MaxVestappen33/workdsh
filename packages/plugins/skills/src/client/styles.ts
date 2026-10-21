import { controlsCss, modalCss } from 'workdsh-ui';

export const skillsCss = `${modalCss}
@layer workdsh-business {


.wd-skills{overflow:auto;box-sizing:border-box}.wd-skills{height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px/22px "PingFang SC","Microsoft YaHei",sans-serif;padding:24px}.wd-skills *{box-sizing:border-box}.wd-skills .nav-toggle{display:none}.wd-skills button,.wd-skills input{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);min-height:36px;padding:6px 12px}.wd-skills button{cursor:pointer}.wd-skills button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.wd-skills button:disabled{cursor:not-allowed}.wd-skills button:disabled{color:var(--dsw-alias-label-dimmed)}.wd-skills :focus-visible{outline-offset:3px}.wd-skills :focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}.wd-skills .cap-header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:28px}.wd-skills .cap-tab{display:flex;align-items:center;gap:7px;white-space:nowrap}.wd-skills .cap-tab{border:0;background:transparent}.wd-skills .cap-tab.active{background:var(--dsw-alias-interactive-bg-hover)}.wd-skills .cap-tab:disabled{cursor:default}.wd-skills .cap-tab:disabled{color:var(--dsw-alias-label-tertiary)}.wd-skills .search{margin-left:auto;width:250px;min-width:150px}.wd-skills .add-skill{white-space:nowrap}.wd-skills .add-menu-wrap,.wd-skills .card-actions{position:relative}.wd-skills .add-skill,.wd-skills .try{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-color:var(--dsw-alias-border-l2);font-weight:600}.wd-skills .add-menu,.wd-skills .card-menu{position:absolute;z-index:20;right:0;top:calc(100% + 8px);width:164px}.wd-skills .add-menu,.wd-skills .card-menu{padding:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 14px 36px var(--dsw-alias-bg-mask-2)}.wd-skills .add-menu button,.wd-skills .card-menu button{display:block;width:100%;text-align:left}.wd-skills .add-menu button,.wd-skills .card-menu button{border:0;background:transparent;min-height:40px;padding:8px 12px}.wd-skills .card-menu .danger{color:var(--dsw-alias-state-error-primary)}.wd-skills .section-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.wd-skills .section-head{padding-bottom:14px}.wd-skills h1{margin:0}.wd-skills h1{font-size:25px;line-height:34px;font-weight:600}.wd-skills .muted{color:var(--dsw-alias-label-tertiary)}.wd-skills .counts{margin:0 0 16px}.wd-skills .counts{font-size:12px}.wd-skills .counts:not(.error):not(.notice){position:absolute;width:1px;overflow:hidden;clip-path:inset(50%)}.wd-skills .counts:not(.error):not(.notice){height:1px}.wd-skills .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px}.wd-skills .card{position:relative;min-width:0;display:flex;flex-direction:column}.wd-skills .card{border-radius:18px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);min-height:128px;padding:14px}.wd-skills .card:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}.wd-skills .card-top{display:flex;align-items:center;gap:14px;min-width:0}.wd-skills .card-open{display:flex;align-items:center;gap:14px;min-width:0;flex:1;text-align:left}.wd-skills .card-open{padding:0;border:0;background:transparent}.wd-skills .card-open:hover:not(:disabled){background:transparent}.wd-skills .card-open strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wd-skills .card-open strong{font-weight:600;font-size:15px}.wd-skills .card p{overflow:hidden;margin:6px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.wd-skills .card p{font-size:15px;line-height:24px;height:48px}.wd-skills .skill-mark{display:inline-grid;place-items:center;width:46px;flex:none;text-transform:uppercase}.wd-skills .skill-mark{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-brand-text);border-radius:50%;height:46px;font-weight:700;font-size:19px}.wd-skills .more-button{width:36px}.wd-skills .more-button{padding:0;border:0;font-size:20px}.wd-skills .switch{width:34px;flex:none}.wd-skills .switch{min-height:20px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-state-success-primary)}.wd-skills .switch::after{content:"";display:block;width:16px;margin-left:14px}.wd-skills .switch::after{height:16px;border-radius:50%;background:white}.wd-skills .empty{text-align:center}.wd-skills .empty{padding:64px 20px}.wd-skills .empty strong{display:block;margin-bottom:8px}.wd-skills .empty strong{font-size:16px}.skill-detail-dialog{padding:24px}.skill-detail-dialog .detail-hero{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:16px;align-items:center}.skill-detail-dialog .detail-hero{padding-right:64px}.skill-detail-dialog .skill-mark{display:inline-grid;place-items:center;width:48px;text-transform:uppercase}.skill-detail-dialog .skill-mark{height:48px;border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-brand-text);font-size:22px;font-weight:700}.skill-detail-dialog .detail-title h1{margin:0 0 10px;overflow-wrap:anywhere}.skill-detail-dialog .detail-title h1{font-size:20px;line-height:28px}.skill-detail-dialog .detail-title p{margin:16px 0 0}.skill-detail-dialog .detail-title p{font-size:14px;line-height:23px;color:var(--dsw-alias-label-primary)}.skill-detail-dialog .detail-actions{display:flex;gap:9px;align-items:center}.skill-detail-dialog button{cursor:pointer}.skill-detail-dialog button{font:inherit;min-height:36px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.skill-detail-dialog .try{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-color:var(--dsw-alias-border-l2);font-weight:600}.skill-detail-dialog .detail-section-title{display:flex;align-items:center;gap:9px;margin:24px 0 12px}.skill-detail-dialog .detail-section-title{font-size:15px}.skill-detail-dialog .detail-body{white-space:normal;overflow-wrap:anywhere}.skill-detail-dialog .detail-body{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:16px}.skill-detail-dialog .detail-body dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px;margin:0}.skill-detail-dialog .detail-body dt{margin:0}.skill-detail-dialog .detail-body dt{color:var(--dsw-alias-label-tertiary)}.skill-detail-dialog .detail-body dd{margin:0;min-width:0}.skill-detail-dialog .command{display:block;overflow-wrap:anywhere}.skill-detail-dialog .command{padding:12px;background:var(--dsw-alias-bg-layer-1);border-radius:8px}.wd-skills svg,.skill-detail-dialog svg{width:20px;stroke:currentColor;stroke-width:1.7;fill:none;stroke-linecap:round}.wd-skills svg,.skill-detail-dialog svg{height:20px}.wd-skills .error,.skill-detail-dialog .error{color:var(--dsw-alias-state-error-primary)}@media(max-width:1400px){.wd-skills .grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:900px){.wd-skills .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wd-skills .search{order:2;margin-left:0;flex:1}.skill-detail-dialog .detail-hero{grid-template-columns:48px minmax(0,1fr)}.skill-detail-dialog .skill-mark{width:48px}.skill-detail-dialog .skill-mark{height:48px;font-size:22px}.skill-detail-dialog .detail-actions{grid-column:1/-1}}@media(max-width:560px){.wd-skills{padding:16px}.wd-skills .nav-toggle{display:block}.wd-skills .grid{grid-template-columns:1fr}.wd-skills .add-menu{right:auto;left:0}.skill-detail-dialog{padding:24px 20px}.skill-detail-dialog .detail-body{padding:16px}.skill-detail-dialog button{min-height:44px}.skill-detail-dialog .detail-actions{flex-wrap:wrap}.skill-detail-dialog .detail-title h1{font-size:20px}}
}
${controlsCss}
.wd-form-textarea.skill-editor{min-height:430px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
`;

export const skillsActionsCss = `${modalCss}
@layer workdsh-business {

.wd-skills .batch-toggle.active{background:var(--dsw-alias-interactive-bg-hover)}.wd-skills .batch-bar{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin:0 0 16px}.wd-skills .batch-bar{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.wd-skills .batch-bar span{margin-right:auto}.wd-skills .batch-bar span{color:var(--dsw-alias-label-secondary)}.wd-skills .batch-check{display:grid;place-items:center;width:24px}.wd-skills .batch-check{min-height:24px;height:24px;padding:0;border-radius:6px;background:var(--dsw-alias-bg-layer-1)}.wd-skills .batch-check[aria-checked="true"]{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-inverted);border-color:var(--dsw-alias-state-success-primary);font-weight:700}
.wd-skills .refresh{margin-left:auto}.wd-skills .card.disabled{opacity:.56}.wd-skills .card.invalid{border-color:var(--dsw-alias-state-warn-primary)}.wd-skills .diagnostic{display:block;margin-top:10px}.wd-skills .diagnostic{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.wd-skills .switch[aria-checked="false"]{background:var(--dsw-alias-interactive-bg-hover)}.wd-skills .switch[aria-checked="false"]::after{margin-left:0}.wd-skills .switch:disabled{opacity:.38}.wd-skills .danger,.skill-detail-dialog .danger{color:var(--dsw-alias-state-error-primary)}.skill-detail-dialog .validation-errors{margin:0 0 24px}.skill-detail-dialog .validation-errors{padding:18px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-1))}.skill-detail-dialog .validation-errors h3{margin:0 0 8px}.skill-detail-dialog .validation-errors h3{color:var(--dsw-alias-state-error-primary)}.skill-detail-dialog .validation-errors ul{margin:0 0 14px}.skill-detail-dialog .validation-errors ul{padding-left:20px}.skill-detail-dialog .skill-document{margin:20px 0 0;border-top:1px solid var(--dsw-alias-border-l2);white-space:pre-wrap}.skill-detail-dialog .skill-document{padding:16px 0;font:13px/21px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary)}.skill-detail-dialog .editor-label{display:block;margin-bottom:10px}.skill-detail-dialog .editor-label{font-weight:600}.skill-detail-dialog .skill-editor{display:block;width:100%;resize:vertical}.skill-detail-dialog .skill-editor{min-height:430px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:13px/21px ui-monospace,SFMono-Regular,Menlo,monospace}.skill-detail-dialog .editor-actions,.confirm-dialog .confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}.skill-detail-dialog .save{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}.confirm-dialog{width:min(480px,calc(100vw - 32px))}.confirm-dialog{padding:24px}.confirm-dialog h2{margin:0 52px 12px 0}.confirm-dialog p{color:var(--dsw-alias-label-tertiary);line-height:1.7}.confirm-dialog button{cursor:pointer}.confirm-dialog button{min-height:40px;padding:8px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.confirm-dialog .danger.solid{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}
.wd-skills .card.menu-open{z-index:25}
.confirm-dialog .dependency-impact{margin:18px 0}
.confirm-dialog .dependency-impact{padding:14px 16px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-1))}.confirm-dialog .dependency-impact ul{margin:8px 0 0}.confirm-dialog .dependency-impact ul{padding-left:20px}.confirm-dialog .dependency-clear{padding:12px 14px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}.confirm-dialog .danger.solid:disabled{cursor:not-allowed}.confirm-dialog .danger.solid:disabled{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-label-tertiary)}
.skill-detail-dialog .resource-section{margin:20px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.skill-detail-dialog .resource-section{padding:16px 0;border:0;border-radius:0}.skill-detail-dialog .resource-section h3{margin:0 0 12px}.skill-detail-dialog .resource-list{display:grid;grid-template-columns:minmax(0,1fr);gap:4px}.skill-detail-dialog .resource-list button{text-align:left;white-space:normal;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.skill-detail-dialog .resource-list button{min-height:32px;padding:6px 10px;border:0;background:transparent;font-size:12px}.skill-detail-dialog .new-resource{display:flex;gap:8px;margin-top:14px}.skill-detail-dialog .new-resource :is(input,.wd-form-input){flex:1;min-width:0}.skill-detail-dialog .new-resource input{padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.skill-detail-dialog .resource-editor-head{display:flex;align-items:center;gap:14px;margin-bottom:20px}.skill-detail-dialog .resource-editor-head strong{overflow-wrap:anywhere}.trash-dialog{width:min(600px,calc(100vw - 32px))}.trash-dialog{padding:24px}.trash-dialog h2{margin:0 52px 20px 0}.trash-dialog .trash-list{display:grid;gap:10px}.trash-dialog .trash-list>div{display:flex;align-items:center;justify-content:space-between;gap:18px}.trash-dialog .trash-list>div{padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}.trash-dialog small{display:block;margin-top:4px}.trash-dialog small{color:var(--dsw-alias-label-tertiary)}.trash-dialog button{cursor:pointer}.trash-dialog button{min-height:36px;padding:6px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Import dialog: one bounded content scroller, compact neutral visual hierarchy. */
.wd-dialog.import-skill-dialog{width:min(600px,calc(100vw - 32px));display:flex;flex-direction:column;overflow:hidden}
/* Import dialog: one bounded content scroller, compact neutral visual hierarchy. */
.wd-dialog.import-skill-dialog{max-height:calc(100dvh - 48px);height:auto;padding:0;border-radius:16px;background:var(--dsw-alias-bg-layer-1);font:14px/22px "PingFang SC","Microsoft YaHei",sans-serif}
.import-skill-dialog *{box-sizing:border-box}
.wd-dialog.import-skill-dialog:focus-visible{outline:none}
.import-skill-dialog .wd-dialog-close{top:16px;right:16px;width:32px;flex:none}
.import-skill-dialog .wd-dialog-close{height:32px;min-height:0;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary)}
.import-skill-dialog .wd-dialog-close span{font-size:25px;line-height:1}
.import-skill-dialog .wd-dialog-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.import-skill-dialog .import-header{flex:none}
.import-skill-dialog .import-header{padding:24px 64px 20px 24px}
.import-skill-dialog .import-header h2{margin:0 0 4px}
.import-skill-dialog .import-header h2{font-size:20px;line-height:28px;font-weight:600}
.import-skill-dialog .import-header p{margin:0}
.import-skill-dialog .import-header p{font-size:13px;color:var(--dsw-alias-label-tertiary)}
.import-skill-dialog .import-content{overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}
.import-skill-dialog .import-content{min-height:0;padding:0 24px 24px}
.import-skill-dialog button,.import-skill-dialog select{font:inherit;color:inherit}
.import-skill-dialog .import-dropzone{width:100%;display:grid;place-content:center;justify-items:center;gap:8px;cursor:pointer}
.import-skill-dialog .import-dropzone{min-height:170px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.import-skill-dialog .import-dropzone:hover,.import-skill-dialog .import-dropzone.dragging{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.import-skill-dialog .import-dropzone:disabled{cursor:wait}
.import-skill-dialog .import-dropzone:disabled{opacity:.7}
.import-skill-dialog .upload-glyph{font-size:26px;color:var(--dsw-alias-label-tertiary)}
.import-skill-dialog .import-dropzone strong{font-size:15px;font-weight:500}
.import-skill-dialog .import-dropzone small{color:var(--dsw-alias-label-tertiary);font-size:12px}
.import-skill-dialog .folder-picker{display:block;margin:12px auto 0;cursor:pointer}
.import-skill-dialog .folder-picker{min-height:36px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent}
.import-skill-dialog .visually-hidden{position:absolute;width:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.import-skill-dialog .visually-hidden{height:1px;padding:0;border:0}
.import-skill-dialog .import-requirements{margin-top:24px}
.import-skill-dialog .import-requirements h3{margin:0 0 8px}
.import-skill-dialog .import-requirements h3{font-size:14px;font-weight:500}
.import-skill-dialog .import-requirements ul{margin:0}
.import-skill-dialog .import-requirements ul{padding-left:20px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:22px}
.import-skill-dialog .import-review-title{display:flex;gap:12px;align-items:flex-start}
.import-skill-dialog .import-review-title{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.import-skill-dialog .skill-mark{width:40px;display:grid;place-items:center;text-transform:uppercase;flex:none}
.import-skill-dialog .skill-mark{height:40px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:18px;font-weight:500}
.import-skill-dialog .import-review-title>div{min-width:0}
.import-skill-dialog .import-review-title h3{margin:0 0 6px;overflow-wrap:anywhere}
.import-skill-dialog .import-review-title h3{font-size:15px;line-height:22px;font-weight:600}
.import-skill-dialog .import-review-title p{margin:0;overflow-wrap:anywhere}
.import-skill-dialog .import-review-title p{font-size:13px;line-height:21px;color:var(--dsw-alias-label-tertiary)}
.import-skill-dialog dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px 16px;margin:20px 0}
.import-skill-dialog dt{color:var(--dsw-alias-label-tertiary);font-size:13px}
.import-skill-dialog dd{margin:0;min-width:0;overflow-wrap:anywhere}
.import-skill-dialog dd{font-size:13px}
.import-skill-dialog select{width:100%}
.import-skill-dialog select{min-height:36px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:13px}
.import-skill-dialog details{border-top:1px solid var(--dsw-alias-border-l2)}
.import-skill-dialog details{padding-top:12px}
.import-skill-dialog summary{cursor:pointer}
.import-skill-dialog summary{font-size:13px;color:var(--dsw-alias-label-secondary)}
.import-skill-dialog .import-file-list{margin:12px 0 0;overflow-wrap:anywhere}
.import-skill-dialog .import-file-list{padding-left:20px;font:12px/22px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary)}
.import-skill-dialog .import-note{margin:16px 0 0}
.import-skill-dialog .import-note{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.import-skill-dialog .import-footer{flex:none;border-top:1px solid var(--dsw-alias-border-l2)}
.import-skill-dialog .import-footer{padding:16px 24px;background:var(--dsw-alias-bg-layer-1)}
.import-skill-dialog .import-actions{display:flex;justify-content:flex-end;gap:8px}
.import-skill-dialog .import-actions button{width:auto;min-width:96px;flex:0 0 auto;white-space:nowrap;cursor:pointer}
.import-skill-dialog .import-actions button{height:36px;min-height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:20px;font-weight:500}
.import-skill-dialog .import-actions .install{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-color:var(--dsw-alias-border-l2)}
.import-skill-dialog button:disabled{cursor:default}
.import-skill-dialog button:disabled{opacity:.5}
.import-skill-dialog button:focus-visible,.import-skill-dialog select:focus-visible,.import-skill-dialog summary:focus-visible{outline-offset:2px}
.import-skill-dialog button:focus-visible,.import-skill-dialog select:focus-visible,.import-skill-dialog summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary)}
.import-skill-dialog .error{margin:16px 0 0}
.import-skill-dialog .error{color:var(--dsw-alias-state-error-primary);font-size:13px}
@media(max-width:640px){.wd-dialog.import-skill-dialog{width:calc(100vw - 24px)}.wd-dialog.import-skill-dialog{max-height:calc(100dvh - 24px);height:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}.import-skill-dialog .import-header{padding:20px 64px 16px 20px}.import-skill-dialog .import-content{padding:0 20px 20px}.import-skill-dialog .import-footer{padding:16px 20px}.import-skill-dialog .wd-dialog-close{width:44px;top:8px;right:8px}.import-skill-dialog .wd-dialog-close{height:44px}.import-skill-dialog dl{grid-template-columns:1fr;gap:4px}.import-skill-dialog dd{margin-bottom:8px}.import-skill-dialog .import-actions button{height:44px;min-height:44px}}



}
${controlsCss}
`;

export const skillsMarketCss = `${modalCss}
@layer workdsh-business {

/* 二级页签（本地技能 / 技能市场）：与连接器页面同款，标题行下方紧跟一行带数量的页签。 */
.wd-skills .source-tabs{display:flex;gap:26px;margin:0 0 18px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.wd-skills .source-tabs button{display:inline-flex;align-items:center;gap:6px;padding:11px 2px;margin-bottom:-1px}
.wd-skills .source-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--dsw-alias-label-secondary)}
.wd-skills .source-tabs button:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.wd-skills .source-tabs button.active{border-bottom-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
/* 数量徽标：浅灰胶囊 + 与标题齐平的数字，紧贴页签名。 */
.wd-skills .source-tabs .count{display:inline-grid;place-items:center;min-width:28px;height:22px;padding:0 9px}
.wd-skills .source-tabs .count{border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:14px;font-style:normal;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.wd-skills .source-tabs button:hover .count,.wd-skills .source-tabs button.active .count{color:var(--dsw-alias-label-primary)}

/* 业务场景胶囊栏 + 「更多」浮层（与连接器页面同款交互）。 */
.wd-skills .category-bar{position:relative;display:flex;align-items:center;gap:7px;margin:0 0 18px;min-width:0}
.wd-skills .category-tabs{display:flex;gap:4px;min-width:0}
.wd-skills .category-tabs button[data-category],.wd-skills .more-btn{padding:6px 12px;border:0;border-radius:9px}
.wd-skills .category-tabs button[data-category],.wd-skills .more-btn{background:transparent;color:var(--dsw-alias-label-secondary);white-space:nowrap}
/* 选中＝与悬浮一致的浅灰圆角底 + 深色加粗；未选中＝无底色灰字。 */
.wd-skills .category-tabs button[data-category]:hover,.wd-skills .more-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-skills .category-tabs button[data-category].active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.wd-skills .category-tabs button[hidden],.wd-skills .more-wrap[hidden],.wd-skills .more-panel[hidden]{display:none}
.wd-skills .more-wrap{position:relative;flex:none;display:inline-flex}
.wd-skills .more-btn{display:inline-flex;align-items:center;gap:5px}
.wd-skills .more-btn .more-count{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:11px;font-style:normal;font-weight:600;line-height:1}
.wd-skills .more-btn .chev{display:inline-flex;transition:transform .12s ease}
.wd-skills .more-btn.open .chev{transform:rotate(180deg)}
.wd-skills .more-panel{position:absolute;top:calc(100% + 8px);right:0;z-index:30;min-width:168px;padding:8px}
.wd-skills .more-panel{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-panel)}
.wd-skills .more-panel button{display:block;width:100%;padding:9px 12px;text-align:left;white-space:nowrap}
.wd-skills .more-panel button{border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary)}
.wd-skills .more-panel button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wd-skills .more-panel button.active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}

.wd-skills .skill-icon{width:46px;flex:none;object-fit:cover}




.wd-skills .skill-icon{height:46px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2)}
.wd-skills .skill-icon.large,.skill-detail-dialog .skill-icon.large{width:48px}
.wd-skills .skill-icon.large,.skill-detail-dialog .skill-icon.large{height:48px;border-radius:12px}
.wd-skills .skill-mark.large{width:48px}
.wd-skills .skill-mark.large{height:48px;border-radius:12px;font-size:44px}
.wd-skills .card-title{display:flex;flex-direction:column;gap:3px;min-width:0}
.wd-skills .card-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-skills .card-title strong{font-weight:600;font-size:17px}
.wd-skills .card-title small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd-skills .card-title small{color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-skills .card-title small.slug{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.wd-skills .card-title small.slug{font-size:11px;color:var(--dsw-alias-label-dimmed)}
.wd-skills .install{display:grid;place-items:center;width:40px}
.wd-skills .install{min-height:40px;height:40px;padding:0;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:20px;line-height:1}
.wd-skills .install:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.wd-skills .install:disabled{opacity:.45}
/* 安装中：加号位置换成转圈，卡片与详情页底部显示流式进度条；失败原因就地显示在卡片上。 */
.wd-skills .plus{display:grid;place-items:center;width:40px;min-height:40px;height:40px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.wd-skills .plus.installing{cursor:default}
.wd-skills .spinner{width:15px;height:15px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:wd-skill-spin .7s linear infinite}
@keyframes wd-skill-spin{to{transform:rotate(360deg)}}
.wd-skills .install-bar,.skill-detail-dialog .install-bar{position:relative;overflow:hidden;height:3px;margin-top:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-3)}
.wd-skills .install-bar-fill,.skill-detail-dialog .install-bar-fill{position:absolute;top:0;bottom:0;left:0;width:40%;border-radius:999px;background:var(--dsw-alias-brand-primary);animation:wd-skill-install 1.2s ease-in-out infinite}
@keyframes wd-skill-install{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
.skill-detail-dialog .install-bar{margin:0 0 16px}
.wd-skills .card.is-installing{border-color:var(--dsw-alias-brand-primary)}
.wd-skills .card-error{overflow:hidden;margin:8px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
/* 卡片内的业务场景标签、市场卡片的版本行与「已安装」胶囊。 */
.wd-skills .card-title small.tag{color:var(--dsw-alias-label-secondary)}
.wd-skills .market-version{display:block;margin-top:10px;color:var(--dsw-alias-label-dimmed);font-size:11px}
/* 市场卡片的主信息（技能编号、简介、版本号）改用主文字色，dimmed/tertiary 在浅色主题下对比度不足。 */
.wd-skills .market-card .card-title small.slug{color:var(--dsw-alias-label-primary)}
.wd-skills .market-card p.muted{color:var(--dsw-alias-label-primary)}
.wd-skills .market-card .market-version{color:var(--dsw-alias-label-primary)}
.wd-skills .installed-pill{flex:none;padding:4px 10px;border-radius:999px}
.wd-skills .installed-pill{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-success-primary);font-size:12px;font-weight:500}
.wd-skills .market-foot{display:flex;justify-content:center;padding:22px 0 6px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.wd-skills p.error{margin:0 0 14px}
.wd-skills p.error button{margin-left:10px}
.wd-skills .notice{color:var(--dsw-alias-state-success-primary)}
.wd-skills .empty .muted{display:block;margin-top:6px}
.wd-skills .empty .muted{font-size:12px}
.skill-detail-dialog .detail-title .slug{margin:0 0 12px}
.skill-detail-dialog .detail-title .slug{font:13px/20px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary)}
/* 技能弹框沿用公共 Modal（.wd-dialog）外壳；用更高特异性只收窄技能相关弹框并紧凑化内部，不改公共默认值。 */
.wd-dialog.skill-detail-dialog{width:min(820px,calc(100vw - 40px))}
.wd-dialog.confirm-dialog{width:min(480px,calc(100vw - 40px))}
.wd-dialog.trash-dialog{width:min(560px,calc(100vw - 40px))}
/* 市场详情的「已安装」：与卡片上的已安装胶囊同色，和可点击的「安装」区分开。 */
.skill-detail-dialog .installed-action{color:var(--dsw-alias-state-success-primary)}

.skill-detail-dialog .detail-summary{margin:20px 0 0}

.skill-detail-dialog .detail-summary{color:var(--dsw-alias-label-secondary);font-size:14px;line-height:23px}




}
${controlsCss}
`;

/**
 * 技能上架申请：表单弹窗、「我的申请」页签的状态筛选与审批状态徽标。
 * 表单沿用技能详情弹窗的视觉语言（圆角卡片 + 紧凑字段），只新增结构类名。
 */
export const skillsListingCss = `${modalCss}
@layer workdsh-business {

/* 弹窗外壳：固定头尾，只有内容区滚动（外壳规则与公共 Modal 冲突，必须放在 @layer 之外）。 */
.skill-listing-dialog *{box-sizing:border-box}
.skill-listing-dialog:focus-visible{outline:none}
.skill-listing-dialog .wd-dialog-close{top:16px;right:16px;width:32px;height:32px;min-height:0;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary)}
.skill-listing-dialog .wd-dialog-close span{font-size:25px;line-height:1}
.skill-listing-dialog .wd-dialog-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.skill-listing-dialog .listing-header{flex:none;padding:24px 64px 16px 24px}
.skill-listing-dialog .listing-header h2{margin:0 0 4px;font-size:20px;line-height:28px;font-weight:600}
.skill-listing-dialog .listing-header p{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.skill-listing-dialog .listing-content{flex:1 1 auto;min-height:0;overflow:auto;display:grid;gap:16px;padding:0 24px 24px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}
/* 分区卡片：左侧色条标题 + 两列字段。 */
.skill-listing-dialog .listing-section{padding:16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.skill-listing-dialog .listing-section h3{display:flex;align-items:center;gap:8px;margin:0 0 16px;font-size:14px;font-weight:600}
.skill-listing-dialog .listing-section h3 i{width:3px;height:14px;border-radius:2px;background:var(--dsw-alias-brand-primary)}
.skill-listing-dialog .listing-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.skill-listing-dialog .listing-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.skill-listing-dialog .listing-field>span{font-size:13px;color:var(--dsw-alias-label-secondary)}
.skill-listing-dialog .listing-field em{font-style:normal;color:var(--dsw-alias-state-error-primary)}
.skill-listing-dialog .listing-field small{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.skill-listing-dialog .listing-field-wide{grid-column:1/-1}
.skill-listing-dialog .listing-textarea{min-height:84px;resize:vertical}
.skill-listing-dialog .listing-counter{align-self:flex-end}
/* 图标：圆形预览 + 上传/清除；未上传时显示名称首字。 */
.skill-listing-dialog .listing-icon-field{display:flex;gap:14px;align-items:flex-start;margin-bottom:16px}
.skill-listing-dialog .listing-icon{display:grid;place-items:center;width:64px;height:64px;flex:none;overflow:hidden;border:1px dashed var(--dsw-alias-border-l2);border-radius:50%;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-brand-text);font-size:22px;font-weight:700}
.skill-listing-dialog .listing-icon img{width:100%;height:100%;object-fit:cover}
/* 自定义标签：整块是一行输入框，标签在行内换行排列。 */
.skill-listing-dialog .listing-icon-actions{display:flex;flex-direction:column;gap:6px;min-width:0}
.skill-listing-dialog .listing-icon-buttons{display:flex;gap:8px}
/* 业务场景多选树：触发器 + 内联展开的树（内联而非浮层，避免被弹窗滚动区裁切）。 */
.skill-listing-dialog .scene-select{position:relative}
.skill-listing-dialog .scene-trigger{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);text-align:left}
.skill-listing-dialog .scene-trigger span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skill-listing-dialog .scene-trigger .placeholder{color:var(--dsw-alias-label-tertiary)}
.skill-listing-dialog .scene-panel{margin-top:6px;max-height:280px;overflow:auto;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.skill-listing-dialog .scene-row{display:flex;align-items:center;gap:6px;min-height:32px}
.skill-listing-dialog .scene-expand{display:grid;place-items:center;width:20px;height:20px;min-height:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary)}
.skill-listing-dialog .scene-expand.placeholder{visibility:hidden}
.skill-listing-dialog .scene-expand svg{transition:transform .12s ease}
.skill-listing-dialog .scene-expand.open svg{transform:rotate(90deg)}
.skill-listing-dialog .scene-label{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px}
.skill-listing-dialog .scene-label input{width:15px;height:15px;min-height:0;padding:0;margin:0}
/* 技能文件：拖拽区与预检结果二选一。 */
.skill-listing-dialog .listing-dropzone{display:grid;place-content:center;justify-items:center;gap:6px;width:100%;min-height:132px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.skill-listing-dialog .listing-dropzone.dragging{border-color:var(--dsw-alias-brand-primary)}
.skill-listing-dialog .listing-dropzone .upload-glyph{font-size:24px;color:var(--dsw-alias-label-tertiary)}
.skill-listing-dialog .listing-dropzone strong{font-size:15px;font-weight:500}
.skill-listing-dialog .listing-file{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.skill-listing-dialog .listing-file-main{display:flex;flex-direction:column;gap:2px;min-width:0}
.skill-listing-dialog .listing-file-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skill-listing-dialog .listing-file-main small{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.skill-listing-dialog .listing-file-main .slug{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.skill-listing-dialog .listing-file-actions{margin-top:10px}
.skill-listing-dialog .visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skill-listing-dialog .listing-footer{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:16px 24px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.skill-listing-dialog .listing-submit{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-color:var(--dsw-alias-border-l2);font-weight:600}
.skill-listing-dialog button:disabled{opacity:.5;cursor:default}
.skill-listing-dialog .error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:13px}
.skill-listing-dialog .error button{margin-left:10px}
/* 我的申请：状态筛选、审批状态徽标与卡片底部信息。 */
.wd-skills .listing-toolbar{display:flex;align-items:center;gap:12px;margin:0 0 18px;min-height:36px}
.wd-skills .listing-status-filter{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.wd-skills .listing-status-filter select{min-height:34px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit}
.wd-skills .status-badge,.skill-detail-dialog .status-badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap}
.wd-skills .status-badge.pending,.skill-detail-dialog .status-badge.pending{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent);color:var(--dsw-alias-state-warn-primary)}
.wd-skills .status-badge.success,.skill-detail-dialog .status-badge.success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);color:var(--dsw-alias-state-success-primary)}
.wd-skills .status-badge.error,.skill-detail-dialog .status-badge.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.wd-skills .status-badge.neutral,.skill-detail-dialog .status-badge.neutral{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.wd-skills .application-card .application-meta{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:10px}
.wd-skills .application-card .application-meta small{color:var(--dsw-alias-label-tertiary);font-size:11px}
.wd-skills .application-card .withdraw{flex:none;min-height:30px;height:30px;padding:0 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.wd-skills .application-card .withdraw:hover{color:var(--dsw-alias-label-primary)}
@media(max-width:640px){.wd-dialog.skill-listing-dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px)}.skill-listing-dialog .listing-header{padding:20px 60px 14px 20px}.skill-listing-dialog .listing-content{padding:0 20px 20px}.skill-listing-dialog .listing-footer{padding:14px 20px}.skill-listing-dialog .listing-grid{grid-template-columns:1fr}}

}
${controlsCss}
/*
 * 表单控件与标签容器必须写在 @layer 之外：controlsCss 不分层，未分层的声明优先于层内样式，
 * 否则 .wd-form-textarea 的 elevation 阴影会把文本框渲染成粗黑边。
 */
.wd-dialog.skill-listing-dialog{width:min(760px,calc(100vw - 40px));height:auto;max-height:calc(100dvh - 48px);padding:0;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-layer-1);font:14px/22px "PingFang SC","Microsoft YaHei",sans-serif}
.skill-listing-dialog :is(select,textarea){width:100%;min-height:36px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;box-shadow:none}
.skill-listing-dialog :is(select,textarea):focus-visible{border-color:var(--dsw-alias-state-business-primary);outline:none}
/* Input 组件是「外层 span(.wd-form-input) + 内层 input」：边框只画在外层，内层保持透明，避免出现双框。 */
.skill-listing-dialog .wd-form-input{display:flex;align-items:center;width:100%;height:36px;min-height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:none}
.skill-listing-dialog .wd-form-input:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.skill-listing-dialog .wd-form-input input{flex:1;width:auto;min-width:0;height:100%;min-height:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;outline:none;font:inherit;color:var(--dsw-alias-label-primary)}
.skill-listing-dialog .wd-form-input input:focus-visible{outline:none}
.skill-listing-dialog .listing-tags{display:flex;align-items:center;flex-wrap:wrap;gap:6px;width:100%;min-height:36px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:text}
.skill-listing-dialog .listing-tags:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.skill-listing-dialog .listing-tags .wd-form-input{flex:1 1 160px;width:auto;min-width:160px;height:26px;min-height:26px;padding:0 4px;border:0;border-radius:0;background:transparent}
.skill-listing-dialog .listing-tag{display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:20px}
.skill-listing-dialog .listing-tag button{width:16px;height:16px;min-height:0;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1}
.skill-listing-dialog .listing-radio-group{display:flex;align-items:center;gap:20px;min-height:36px}
.skill-listing-dialog .listing-radio{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer}
.skill-listing-dialog .listing-radio input{width:15px;height:15px;min-width:0;min-height:0;margin:0;padding:0;border:0;background:transparent}
`;
