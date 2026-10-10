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
