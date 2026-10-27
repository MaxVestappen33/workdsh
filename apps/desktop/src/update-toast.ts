/** 左下角“新版本可用”提醒条的静态文档；内容由 update-toast-preload 填充。 */
export function updateToastHtml(): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>新版本提醒</title>
<style>
:root{
  color-scheme:light;
  --surface:#fff;--border:#e2e7ef;--text:#151a23;--muted:#6c7686;
  --brand:#2f6bff;--brand-on:#fff;--brand-soft:#eaf0ff;--brand-text:#2149b8;
}
@media(prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --surface:#1a1d23;--border:#2c313b;--text:#e9ecf1;--muted:#9aa3b2;
    --brand:#6d96ff;--brand-on:#0d1117;--brand-soft:#1d2740;--brand-text:#a8c2ff;
  }
}
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:transparent;overflow:hidden}
body{font:13px/18px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--text);display:flex;align-items:flex-end;padding:0 10px 10px}
.bar{width:100%;display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 8px 8px 12px;box-shadow:0 6px 20px rgba(15,23,42,.12)}
.icon{flex:none;width:20px;height:20px;border-radius:6px;background:var(--brand-soft);color:var(--brand-text);font-weight:700;font-size:12px;line-height:20px;text-align:center}
.label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
button{font:600 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;border-radius:6px;padding:4px 10px;cursor:pointer;border:1px solid transparent}
button.ghost{border-color:var(--brand);color:var(--brand-text);background:transparent}
button.ghost:hover{background:var(--brand-soft)}
button.primary{background:var(--brand);border-color:var(--brand);color:var(--brand-on)}
button.primary:hover{filter:brightness(1.05)}
button.close{flex:none;width:22px;height:22px;padding:0;background:transparent;color:var(--muted);font-weight:400;font-size:14px;line-height:20px}
button.close:hover{background:var(--brand-soft);color:var(--text)}
button:focus-visible{outline:2px solid var(--brand);outline-offset:1px}
[hidden]{display:none!important}
</style>
<div class="bar">
<div class="icon">&#8593;</div>
<div class="label" id="label">新版本已就绪</div>
<button class="ghost" id="notes">更新日志</button>
<button class="primary" id="restart">重启升级</button>
<button class="close" id="close" aria-label="关闭" title="关闭">&#215;</button>
</div>
</html>`
}
