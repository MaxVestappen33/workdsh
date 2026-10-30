/** Carrier connection UI only; login and all product features remain in the Profile/server. */

/** Carrier brand mark. The Carrier workspace cannot import workdsh-ui, so the packaged application artwork is inlined here as well. */
const BRAND_MARK = '<svg viewBox="22 22 214 214" aria-hidden="true" focusable="false">'
  + '<defs>'
  + '<linearGradient id="workdsh-mark-cool" x1="0.12" y1="0.02" x2="0.5" y2="1"><stop offset="0" stop-color="#D6F8FE"/><stop offset="0.26" stop-color="#8FDBFA"/><stop offset="0.58" stop-color="#3E82F8"/><stop offset="1" stop-color="#2138CE"/></linearGradient>'
  + '<linearGradient id="workdsh-mark-warm" x1="0.85" y1="0.06" x2="0.22" y2="0.94"><stop offset="0" stop-color="#FBB8F7"/><stop offset="0.38" stop-color="#D97BF7"/><stop offset="0.72" stop-color="#9B3FEE"/><stop offset="1" stop-color="#6B27D6"/></linearGradient>'
  + '<linearGradient id="workdsh-mark-warm-top" x1="0.55" y1="0.2" x2="1" y2="0.8"><stop offset="0" stop-color="#F9AEF6"/><stop offset="0.6" stop-color="#C86BF4"/><stop offset="1" stop-color="#7B34E4"/></linearGradient>'
  + '</defs>'
  + '<circle cx="128" cy="128" r="106" fill="url(#workdsh-mark-cool)"/>'
  + '<path d="M174 126C178 130 188 136 191 152C194 174 178 200 152 216C138 226 122 230 116 226C100 224 76 214 56 198C40 185 30 168 31 166C45 178 68 192 90 195C116 197 142 184 158 165C170 150 173 133 174 126Z" fill="url(#workdsh-mark-warm)"/>'
  + '<path d="M177 63C196 62 218 72 228 90C238 108 238 132 227 142C218 149 204 148 201 158C199 148 196 128 180 106C168 90 160 88 157 88C162 82 170 72 177 63Z" fill="url(#workdsh-mark-warm-top)"/>'
  + '<path d="M148 53C170 48 196 54 210 68C198 61 178 59 166 61C150 64 134 76 127 88C140 92 166 96 178 107C189 118 185 142 175 158C165 174 146 183 129 184C109 185 88 171 78 149C68 127 72 101 90 81C108 61 128 56 148 53Z" fill="#050B22"/>'
  + '</svg>'

export function connectionEntryHtml(portal: string, managed: boolean = false, enterpriseAvailable = true): string {
  const escaped = portal.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action workdsh:; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>警务助手</title>
<style>:root{color-scheme:light dark;--bg:#f5f7fa;--panel:#fff;--text:#171a20;--muted:#626b78;--border:#dce1e8}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;display:grid;min-height:100vh;place-items:center}main{width:min(440px,calc(100vw - 48px));padding:32px;background:var(--panel);border:1px solid var(--border);border-radius:16px}header{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:600;margin-bottom:24px}header svg{width:24px;height:24px;flex:none}h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:0 0 20px}a,button{display:block;width:100%;text-align:center;border-radius:8px;padding:10px 16px;font:inherit;text-decoration:none;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer}button{background:#2463eb;color:white;border-color:#2463eb;margin-top:12px}form{margin-top:24px;padding-top:24px;border-top:1px solid var(--border)}label{display:block;margin-bottom:8px}input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font:inherit}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #80aaff;outline-offset:2px}@media(prefers-color-scheme:dark){:root{--bg:#121212;--panel:#202020;--text:#e7e7e7;--muted:#a5a5a5;--border:#414141}}</style>
<main><header>${BRAND_MARK} 警务助手</header><h1>选择使用方式</h1><p>官方 DSH 在本机运行。个人与企业使用独立空间。</p><a href="workdsh://personal">个人使用</a><form action="workdsh://enterprise" method="get">${managed ? `<label>企业后台</label><p>${escaped}</p>` : `<label for="portal">企业后台地址</label><input id="portal" name="portal" type="url" required placeholder="https://企业地址" value="${escaped}" autocomplete="url">`}${enterpriseAvailable ? `<button type="submit">企业登录</button>` : `<button type="button" disabled>请先安装企业账号插件</button><p>进入个人空间，在插件管理中安装企业插件，再从工作区菜单切换到企业登录。</p>`}</form></main></html>`
}

export function enterpriseLoginHtml(backend: string): string {
  const base = connectionEntryHtml(backend)
  const start = base.indexOf('<main>')
  const escaped = backend.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)
  return base.slice(0, start).replace('form-action workdsh:', "form-action 'none'") + `<main><header>${BRAND_MARK} 警务助手</header><h1>登录企业 Desktop</h1><p>${escaped}</p><form id="enterprise-login"><label for="account">账号</label><input id="account" autocomplete="username" required maxlength="254"><label for="password" style="margin-top:16px">密码</label><input id="password" type="password" autocomplete="current-password" required maxlength="512"><button type="submit">登录并在本机运行</button></form><p id="status" role="status" style="margin-top:16px"></p><a href="workdsh://entry" style="margin-top:16px">返回使用方式</a></main></html>`
}

/** Trusted carrier loading surface; no remote content or credentials are embedded. */
export function connectionLoadingHtml(message: string): string {
  const base = connectionEntryHtml('')
  const escaped = message.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)
  return base.slice(0, base.indexOf('<main>')) + `<style>main{animation:appear .16s ease-out}.spinner{width:28px;height:28px;border:3px solid var(--border);border-top-color:#2463eb;border-radius:50%;animation:spin .8s linear infinite;margin:24px auto}@keyframes spin{to{transform:rotate(360deg)}}@keyframes appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){main,.spinner{animation:none}}</style><main aria-busy="true"><header>${BRAND_MARK} 警务助手</header><h1 role="status">${escaped}</h1><p>正在准备工作区并启动本机 DSH，请稍候。运行环境和内置插件已随安装包提供。</p><div class="spinner" aria-hidden="true"></div></main></html>`
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Account splash (参考 WorkBuddy 初始化准备页面): light surface, the whole block centred
 * both ways — logo, title, subtitle and an indeterminate green progress bar.
 * PNG logo is inlined as a base64 data URI by the main process; the page never
 * loads remote resources (CSP keeps `default-src 'none'`).
 */
export function accountSplashHtml(logo: string | undefined, copy: { title: string, subtitle: string }): string {
  const mark = logo !== undefined ? `<img src="${logo}" alt="logo" class="logo">` : BRAND_MARK
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>警务助手</title>
<style>:root{color-scheme:light;--text:#111827;--muted:#4b5563;--faint:#6b7280;--track:#dbe7fd;--accent:#2463eb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{display:flex;flex-direction:column;align-items:center;text-align:center;padding:24px}.logo{width:clamp(180px,calc(100vh - 270px),400px);height:auto;object-fit:contain;margin:0 0 26px}.title{font-size:40px;font-weight:700;letter-spacing:1px;margin:0 0 14px}.subtitle{font-size:16px;color:var(--muted);margin:0 0 34px}.bar{position:relative;width:min(560px,72vw);height:6px;border-radius:3px;background:var(--track);overflow:hidden}.bar-fill{position:absolute;top:0;bottom:0;left:0;width:30%;border-radius:3px;background:var(--accent);animation:sweep 1.4s ease-in-out infinite;will-change:transform}@keyframes sweep{0%{transform:translateX(-100%)}100%{transform:translateX(334%)}}</style>
<main id="splash">${mark}<h1 class="title">${escapeHtml(copy.title)}</h1><p class="subtitle">${escapeHtml(copy.subtitle)}</p><div class="bar" id="splash-bar"><i class="bar-fill"></i></div></main></html>`
}

/**
 * Account login page (参考 WorkBuddy 登录页): light surface, centred line-art logo,
 * large bold title, black pill button and bottom legal links. Credentials are submitted
 * to the main process over IPC by connection-preload; the backend address is not rendered.
 */
export function accountLoginHtml(logo: string | undefined, title: string): string {
  const mark = logo !== undefined ? `<img src="${logo}" alt="logo" class="logo">` : BRAND_MARK
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · ${escapeHtml(title)}</title>
<style>:root{color-scheme:light;--text:#17181c;--muted:#8b9099;--border:#e4e7ec;--field:#f6f7f9}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;grid-template-rows:1fr auto;background:#fff;color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px}.logo{width:clamp(180px,calc(100vh - 450px),400px);height:auto;object-fit:contain;margin:0 0 18px}.title{font-size:32px;font-weight:700;letter-spacing:.5px;margin:0 0 34px}form{display:flex;flex-direction:column;width:min(336px,100%)}input{width:100%;padding:13px 16px;margin-bottom:12px;border:1px solid var(--border);border-radius:12px;background:var(--field);color:var(--text);font:inherit;outline:none}input::placeholder{color:#a8aeb8}input:focus{border-color:#111;background:#fff}button{margin:10px auto 0;width:186px;padding:13px 0;border:0;border-radius:999px;background:#111;color:#fff;font:inherit;font-weight:600;letter-spacing:2px;cursor:pointer}button:active{transform:translateY(1px)}button:disabled{opacity:.5;cursor:default}#status{display:none;margin:16px 0 0;font-size:13px;line-height:1.5;text-align:center}#status.show{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;border:1px solid transparent;border-radius:10px;font-weight:500}#status.show::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}#status.pending{color:#5b6472;background:#f3f4f6;border-color:#e5e7eb}#status.ok{color:#0f7a4d;background:#e8f7ef;border-color:#c3e9d6}#status.error{color:#c0392b;background:#fdecea;border-color:#f6cdc7}footer{padding:0 0 26px;text-align:center;font-size:13px;color:var(--muted)}footer span{margin:0 17px;cursor:pointer}footer span:hover{color:#111}@media(prefers-color-scheme:dark){:root{color-scheme:light}}</style>
<main class="login">${mark}<h1 class="title">${escapeHtml(title)}</h1>
<form id="account-login" autocomplete="on">
<input id="account" placeholder="请输入账号" aria-label="账号" autocomplete="username" required maxlength="254" spellcheck="false">
<input id="password" type="password" placeholder="请输入密码" aria-label="密码" autocomplete="current-password" required maxlength="512">
<button type="submit" id="login-button">登录</button><p id="status" role="status" aria-live="polite"></p>
</form>
</main><footer></footer></html>`
}
