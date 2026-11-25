/**
 * TongyunTagSingle 样式：卡片状态标签的统一规格
 * （20px 高 / 4px 圆角 / 1px 描边 / 12px 字号 / 20px 行高）。
 * 类名以 `wd-tag-single` 前缀独立命名，不依赖父级作用域隔离。
 */
export const tongyunTagSingleCss = `
.wd-tag-single{display:inline-flex;align-items:center;flex:none;box-sizing:border-box;height:20px;padding:0 5px;border:1px solid transparent;border-radius:4px;font-size:12px;line-height:18px;font-weight:400;white-space:nowrap}
.wd-tag-single--gray{background:whitesmoke;border-color:#fff;color:#434343}
.wd-tag-single--cyan{background:#e6fffb;border-color:#87e8de;color:#08979c}
.wd-tag-single--green{background:#f6ffed;border-color:#b7eb8f;color:#389e0d}
.wd-tag-single--blue{background:#e6f4ff;border-color:#91caff;color:#0958d9}
.wd-tag-single--red{background:#fff2f0;border-color:#ffccc7;color:#cf1322}
.wd-tag-single--custom{background:var(--wd-tag-single-bg);border-color:var(--wd-tag-single-border);color:var(--wd-tag-single-text)}
`;
