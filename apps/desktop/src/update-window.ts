/** 独立更新窗口的静态文档；内容由 update-preload 根据主进程状态填充。 */
export interface UpdateWindowOptions {
  /** 安装阶段的进度页：只保留最小化，避免用户关掉后再也看不到安装进度。 */
  readonly progressOnly?: boolean
}

export function updateWindowHtml(options: UpdateWindowOptions = {}): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>软件更新</title>
<style>
:root{
  color-scheme:light;
  --bg:#f6f8fb;--surface:#fff;--surface-muted:#f5f7fa;
  --border:#e2e7ef;--text:#151a23;--muted:#6c7686;--faint:#9aa3b2;
  --brand:#2f6bff;--brand-on:#fff;--brand-soft:#eaf0ff;--brand-text:#2149b8;
  --warn:#b45309;--warn-soft:#fff3e2;--track:#e8ecf3;--danger:#d93a3f;
}
@media(prefers-color-scheme:dark){
  :root{
    color-scheme:dark;
    --bg:#101216;--surface:#1a1d23;--surface-muted:#22262e;
    --border:#2c313b;--text:#e9ecf1;--muted:#9aa3b2;--faint:#77808f;
    --brand:#6d96ff;--brand-on:#0d1117;--brand-soft:#1d2740;--brand-text:#a8c2ff;
    --warn:#f0b34a;--warn-soft:#372a15;--track:#2a2f39;--danger:#f2555a;
  }
}
*{box-sizing:border-box}[hidden]{display:none!important}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font:14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;display:flex;flex-direction:column;overflow:hidden}
.titlebar{-webkit-app-region:drag;flex:none;display:flex;align-items:center;gap:8px;height:44px;padding:0 8px 0 16px;background:var(--surface);border-bottom:1px solid var(--border);user-select:none}
.mark{width:22px;height:22px;border-radius:7px;background:var(--brand);color:var(--brand-on);font-weight:600;font-size:12px;line-height:22px;text-align:center;flex:none}
.name{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.drag{flex:1;height:100%}
.ctl{-webkit-app-region:no-drag;flex:none;width:32px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--faint);font:14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.ctl:hover{background:var(--surface-muted);color:var(--text)}
.ctl:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
.ctl[disabled]{opacity:.35;cursor:default;background:transparent;color:var(--faint)}
.ctl.close:not([disabled]):hover{background:var(--danger);color:#fff}
main{flex:1;min-height:0;width:100%;max-width:760px;margin:0 auto;padding:20px 24px;display:flex;flex-direction:column;gap:16px;overflow:hidden}
.head{flex:none;display:flex;gap:12px;align-items:flex-start}
.appicon{flex:none;width:44px;height:44px;border-radius:12px;background:var(--brand-soft);color:var(--brand-text);font-weight:600;font-size:15px;line-height:44px;text-align:center}
.headline{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.h1{font-weight:600;font-size:16px;line-height:24px;color:var(--text);overflow-wrap:anywhere}
.meta{font-size:12px;line-height:18px;color:var(--muted);overflow-wrap:anywhere}
.badge{align-self:flex-start;font-weight:500;font-size:12px;line-height:20px;color:var(--warn);background:var(--warn-soft);border-radius:999px;padding:0 8px}
.notes-wrap{flex:1;min-height:0;display:flex}
.notes{flex:1;overflow:auto;background:var(--surface-muted);border:1px solid var(--border);border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.7;color:var(--text);overflow-wrap:anywhere}
.notes>:first-child{margin-top:0}.notes>:last-child{margin-bottom:0}
.notes h1,.notes h2,.notes h3,.notes h4{margin:12px 0 6px;line-height:1.4;font-weight:600}
.notes h1{font-size:16px}.notes h2{font-size:15px}.notes h3,.notes h4{font-size:14px}
.notes p{margin:0 0 8px}
.notes ul,.notes ol{margin:0 0 8px;padding-left:20px}
.notes li{margin:2px 0}
.notes code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--surface);border:1px solid var(--border);padding:1px 4px;border-radius:4px;font-size:12px}
.notes pre{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;overflow:auto;margin:0 0 8px}
.notes pre code{background:none;border:0;padding:0}
.notes blockquote{margin:0 0 8px;padding-left:12px;border-left:3px solid var(--border);color:var(--muted)}
.notes a{color:var(--brand)}
.notes hr{border:0;border-top:1px solid var(--border);margin:12px 0}
.progress-block{flex:none;display:flex;flex-direction:column;gap:8px}
.progress-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:12px;line-height:18px;color:var(--muted)}
.pct{font-weight:600;font-size:13px;line-height:20px;color:var(--text)}
.track{height:6px;border-radius:999px;background:var(--track);overflow:hidden}
.bar{height:100%;width:0;border-radius:999px;background:var(--brand);transition:width .16s linear}
.bar.indeterminate{width:35%;animation:dsh-slide 1.1s ease-in-out infinite}
@keyframes dsh-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
@media(prefers-reduced-motion:reduce){.bar.indeterminate{animation:none;width:100%;opacity:.45}}
.latest{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center}
.latest .appicon{width:52px;height:52px;line-height:52px;font-size:17px}
.checks{font-size:12px;line-height:18px;color:var(--faint)}
.upgrading{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:8px 0}
.up-title{font-weight:600;font-size:20px;line-height:28px;color:var(--text)}
.up-sub{font-size:13px;line-height:20px;color:var(--muted);max-width:440px}
.upgrading .track{width:100%;max-width:440px}
.up-status{font-size:12px;line-height:18px;color:var(--faint)}
footer{flex:none;width:100%;max-width:760px;margin:0 auto;padding:0 24px 20px;display:flex;justify-content:flex-end;gap:8px}
button.btn{font:500 14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;padding:8px 20px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer}
button.btn:hover{border-color:var(--faint)}
button.btn.primary{background:var(--brand);border-color:var(--brand);color:var(--brand-on)}
button.btn.primary:hover{filter:brightness(1.05)}
button.btn.ghost{border-color:transparent;color:var(--muted)}
button.btn.ghost:hover{background:var(--surface-muted);color:var(--text)}
button.btn:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
</style>
<div class="titlebar">
<div class="mark">警</div><div class="name">警务助手 · 软件更新</div><div class="drag"></div>
<button class="ctl" id="min" aria-label="最小化" title="最小化">&#8211;</button>
${options.progressOnly === true ? '' : `<button class="ctl" id="max" aria-label="最大化" title="最大化">&#9633;</button>
<button class="ctl close" id="close" aria-label="关闭" title="关闭">&#215;</button>`}
</div>
<main>
<div class="head" id="head">
<div class="appicon">警</div>
<div class="headline">
<span class="badge" id="badge" hidden>强制更新</span>
<div class="h1" id="h1">正在检查更新</div>
<div class="meta" id="meta"></div>
</div>
</div>
<div class="notes-wrap" id="notesWrap" hidden><div class="notes" id="notes"></div></div>
<div class="upgrading" id="upgrading" hidden>
<div class="up-title" id="upTitle">正在安装更新</div>
<div class="up-sub" id="upSub">更新即将完成，应用将自动重启，请稍候…</div>
<div class="track"><div class="bar" id="upBar"></div></div>
<div class="up-status" id="upStatus">正在安装…</div>
</div>
<div class="latest" id="latest" hidden>
<div class="appicon">警</div>
<div class="h1" id="latestTitle">当前已是最新版本</div>
<div class="meta" id="latestMeta"></div>
<div class="checks" id="latestChecks"></div>
</div>
</main>
<footer><button class="btn ghost" id="secondary" hidden></button><button class="btn primary" id="primary" hidden></button></footer>
</html>`
}
