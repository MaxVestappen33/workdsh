/** 独立更新窗口的静态文档；内容由 update-preload 根据主进程状态填充。 */
export function updateWindowHtml(): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>软件更新</title>
<style>
:root{color-scheme:light;--bg:#f5f7fa;--panel:#fff;--text:#171a20;--muted:#626b78;--border:#dce1e8;--accent:#2463eb;--track:#e4ebf7}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;display:grid;place-items:center;min-height:100vh;padding:20px}
main{width:100%;max-width:560px;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:22px 24px 20px;display:flex;flex-direction:column;gap:14px}
header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.title{font-size:18px;font-weight:600}
.version{font-size:14px;color:var(--muted)}
.badge{font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--border);color:var(--muted)}
.badge.beta{color:#8a5a00;border-color:#f0d29a;background:#fff8e8}
.badge.alpha{color:#9a3412;border-color:#f3c1b1;background:#fff3ef}
.status{margin:0;color:var(--muted);min-height:22px}
.status.strong{color:var(--text)}
.progress{height:6px;border-radius:3px;background:var(--track);overflow:hidden}
.bar{height:100%;width:0;background:var(--accent);transition:width .16s linear;border-radius:3px}
.notes{max-height:340px;overflow:auto;padding-right:6px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding-top:12px;padding-bottom:12px;font-size:13px;line-height:1.65}
.notes h1,.notes h2,.notes h3,.notes h4{margin:12px 0 6px;line-height:1.35}
.notes h1{font-size:17px}.notes h2{font-size:15px}.notes h3{font-size:14px}
.notes p{margin:0 0 8px}.notes ul,.notes ol{margin:0 0 8px;padding-left:20px}
.notes li{margin:2px 0}
.notes code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f2f4f7;padding:1px 4px;border-radius:4px;font-size:12px}
.notes pre{background:#f6f7f9;border:1px solid var(--border);border-radius:8px;padding:10px;overflow:auto;margin:0 0 8px}
.notes pre code{background:none;padding:0}
.notes blockquote{margin:0 0 8px;padding-left:10px;border-left:3px solid var(--border);color:var(--muted)}
.notes a{color:var(--accent)}
.notes hr{border:0;border-top:1px solid var(--border);margin:12px 0}
footer{display:flex;justify-content:flex-end;gap:10px}
button{font:inherit;padding:9px 18px;border-radius:8px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
button:focus-visible{outline:3px solid #80aaff;outline-offset:2px}
button:disabled{opacity:.55;cursor:default}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#121212;--panel:#1f1f1f;--text:#e7e7e7;--muted:#a5a5a5;--border:#414141;--accent:#4b86ff;--track:#2c3a52}.notes code,.notes pre{background:#2a2a2a}.badge.beta{color:#ffd58a;border-color:#6b5a33;background:#3a321f}.badge.alpha{color:#ffb59e;border-color:#6d4437;background:#3a241f}}
</style>
<main>
<header><div class="title">软件更新</div><div class="version" id="version" hidden></div><span class="badge" id="type" hidden></span></header>
<p class="status" id="status" role="status" aria-live="polite">正在检查更新…</p>
<div class="progress" id="progress" hidden><div class="bar" id="bar"></div></div>
<section class="notes" id="notes" hidden></section>
<footer><button id="primary" class="primary" hidden></button><button id="secondary" hidden></button></footer>
</main></html>`
}
