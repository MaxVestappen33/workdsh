/** WorkDSH 侧栏底部个人账号入口：占用官方 settings.launcher 槽位，取代回退的「设置」行。 */
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Menu, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

export const name = 'workdsh-account-settings-client';
export const inject = ['slots'];

/** 同源账号读取与退出：Desktop 由账号身份提供方托管，浏览器形态下不存在。 */
const ACCOUNT_PATH = '/api/auth/me';
const LOGOUT_PATH = '/api/auth/logout';
const ACCOUNT_TIMEOUT_MS = 8_000;
/** 退出登录的最短点击间隔：请求失败（如后端无响应）后仍保持锁定，避免被连点反复打请求。 */
const LOGOUT_COOLDOWN_MS = 3_000;
/** SkillHub 广场的入口按钮：侧栏展示已由 WorkDSH 隐藏，改由本菜单触发同一个广场。 */
const PLAZA_TRIGGER_SELECTOR = '.sh-plaza-trigger';

/** 账号档案：不可用时整体为 undefined，入口退化为官方回退的「设置」外观。 */
type AccountProfile = {
  readonly displayName: string;
  readonly organizationName?: string;
  readonly avatar?: string;
};

export function apply(ctx: Context): void {
  // 官方 ui-settings-account 在 0.2.1-rc.5 里会无条件注册 settings.launcher（官方壳和普通 Web 都注册），
  // 并不存在“两边互斥”的判定。这里刻意保持同优先级 0，并且依赖 Profile 让本插件先注册：
  // 官方随后用 0 注册时 slot 会抛错，它的入口因此永远不会挂载，也不会作为备选出现。
  // 注意：不要改优先级。改成 -1 会让官方入口成为我们卸载后的备选；改成 1 则官方 0 胜出、我们的账号菜单消失。
  // 代价是每次启动会留下一条已知的 Uncaught Error，排序或 bundle 顺序变化时可能反转，调整 Profile 时需复核。
  if ('dshDesktop' in globalThis) return;
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher' }, AccountLauncher));
}

/** 读取当前登录账号；失败或不存在时保持 undefined，由入口退化为「设置」。
 *  首次在挂载时读取，之后可由调用方（打开菜单）触发刷新，避免后端改了头像/组织名却要重启才生效。 */
function useAccountProfile(): { profile?: AccountProfile, desktop: boolean, refresh: () => void } {
  const [profile, setProfile] = useState<AccountProfile>();
  // 桌面身份提供方在 /api/auth/me 里带 desktop: true；浏览器形态没有这条路由。
  const [desktop, setDesktop] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  const read = useCallback((): void => {
    // 已有请求在途时忽略本次触发，避免连点菜单产生并发请求。
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    void (async () => {
      try {
        const response = await fetch(ACCOUNT_PATH, {
          credentials: 'same-origin',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(ACCOUNT_TIMEOUT_MS)]),
        });
        if (!response.ok) return;
        const value = await response.json() as { displayName?: unknown, organizationName?: unknown, avatar?: unknown, backendUrl?: unknown, desktop?: unknown };
        if (controller.signal.aborted) return;
        setDesktop(value?.desktop === true);
        // 身份显示是可选信息：字段不完整时不猜、不降级成假账号，直接保持「设置」形态。
        if (typeof value?.displayName !== 'string' || !value.displayName) return;
        const organizationName = organizationLabel(value.organizationName, value.backendUrl);
        setProfile({
          displayName: value.displayName,
          ...(organizationName === undefined ? {} : { organizationName }),
          ...(typeof value.avatar === 'string' && value.avatar ? { avatar: absoluteUrl(value.avatar, value.backendUrl) } : {}),
        });
      } catch { /* 账号身份可选：读取失败不阻断界面，也不重试。 */ }
      finally { if (pending.current === controller) pending.current = undefined; }
    })();
  }, []);
  useEffect(() => { read(); return () => { pending.current?.abort(); pending.current = undefined; }; }, [read]);
  // 主进程后台刷新了用户信息快照，渲染层不会自动感知；这里叠加 60s 轮询保持展示同步。
  // 同源 loopback 请求，成本可忽略；打开菜单时的即时刷新仍保留。
  useEffect(() => {
    const timer = setInterval(() => read(), 60_000);
    return () => clearInterval(timer);
  }, [read]);
  return { profile, desktop, refresh: read };
}

/** 后端头像可能是相对路径；统一成绝对地址。相对路径按后台地址(backendUrl)解析，
 *  而不是按当前 DSH 页面源解析——否则会去本机 DSH 服务上找图片。失败时原样返回由图片自身回退。 */
function absoluteUrl(value: string, backendUrl: unknown): string {
  if (/^(?:https?:|data:)/iu.test(value)) return value;
  const base = typeof backendUrl === 'string' && backendUrl ? backendUrl : window.location.origin;
  try { return new URL(value, base).href; } catch { return value; }
}

/**
 * 组织名：主进程在登录响应缺少 orgCodeTxt 时用账号服务主机名兜底（例如 127.0.0.1），
 * 那是部署细节而不是组织名。这里按 /api/auth/me 返回的 backendUrl 识别这种兜底并隐藏该行，
 * 后端补上 orgCodeTxt 后自动恢复显示。
 */
function organizationLabel(value: unknown, backendUrl: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return value === accountHost(backendUrl) ? undefined : value;
}

function accountHost(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try { return new URL(value).hostname; } catch { return undefined; }
}

/** 头像首字与配色：不依赖远端图片也能稳定区分不同账号。 */
const AVATAR_COLORS = ['#3b6ef5', '#2f9e6f', '#b5651d', '#7a4fd6', '#c2417a'] as const;

function avatarInitial(name: string): string {
  return Array.from(name.trim())[0] ?? '·';
}

function avatarColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

/** 头像：优先后端图片，加载失败或未提供时回退姓名首字。 */
function AccountAvatar({ profile, size }: { profile: AccountProfile, size: number }) {
  const [broken, setBroken] = useState(false);
  const avatar = profile.avatar;
  // 头像地址变化时复位失败标记：否则一次加载失败会让本组件在整个会话内永久回退首字，
  // 即使之后刷新拿到了新的可用地址也不再重试。
  useEffect(() => { setBroken(false); }, [avatar]);
  if (avatar && !broken) {
    return <img className="wd-account-avatar" src={avatar} alt="" width={size} height={size} onError={() => setBroken(true)} />;
  }
  return (
    <span
      className="wd-account-avatar"
      style={{ width: size, height: size, background: avatarColor(profile.displayName), fontSize: Math.round(size * 0.44) }}
      aria-hidden
    >
      {avatarInitial(profile.displayName)}
    </span>
  );
}

function GearIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      <path d="M9 3l1-2h4l1 2 3 2 2 0 2 4-1 2v3l1 2-2 4h-2l-3 2h-6l-3-2H4l-2-4 1-2v-3L2 9l2-4h2zM16 12a4 4 0 11-8 0 4 4 0 018 0" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      <path d="M14 4H7a2 2 0 00-2 2v12a2 2 0 002 2h7M11 12h9M17 8l4 4-4 4" />
    </svg>
  );
}

function PlazaIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      <path d="M4 5h7v6H4zM13 5h7v6h-7zM4 14h7v5H4zM13 14h7v5h-7z" />
    </svg>
  );
}

function UpdateIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      <path d="M20 12a8 8 0 11-2.34-5.66M20 5v5h-5" />
    </svg>
  );
}

function LogFileIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable={false}>
      <path d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6" />
    </svg>
  );
}

/** 桌面载体的窄通道：工作台里用一次 workdsh:// 导航触发检查更新，不往官方页面注入桥。 */
const CHECK_UPDATE_PATH = 'workdsh://check-update';
/** 与单个会话的诊断包区分：这里导出整个软件的运行日志，由载体主进程收集。 */
const DOWNLOAD_LOGS_PATH = 'workdsh://runtime-logs';

/** 侧栏底部入口：账号可用时为头像 + 姓名，否则复用官方「设置」外观。 */
function AccountLauncher({ wide, settingsShortcut, openSettings }: PropsRuntime<'settings.launcher'>) {
  const { profile, desktop, refresh } = useAccountProfile();
  const [open, setOpen] = useState(false);
  const [plazaReady, setPlazaReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** 「刷新缓存」在途：避免连点重复拉取用户信息与授权快照。 */
  const [cacheBusy, setCacheBusy] = useState(false);
  /** 刷新结果：显示在「刷新缓存」这一行右侧（进行中为蓝色，成功绿色、失败红色），结束后 3 秒自动消失。 */
  const [cacheResult, setCacheResult] = useState<'busy' | 'ok' | 'fail' | 'policy-fail'>();
  const cacheTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(cacheTimer.current); }, []);
  const showCacheResult = (result: 'ok' | 'fail' | 'policy-fail'): void => {
    setCacheResult(result);
    window.clearTimeout(cacheTimer.current);
    cacheTimer.current = window.setTimeout(() => setCacheResult(undefined), 3_000);
  };
  const dismissCacheResult = (): void => {
    window.clearTimeout(cacheTimer.current);
    setCacheResult(undefined);
  };
  // 连点保护：busy 状态要等下一次渲染才生效，双击/连点仍可能发出第二个退出请求；
  // 这里用 ref 在事件处理里同步上锁，请求失败后还保留一段冷却期。
  const signingOut = useRef(false);
  // 主进程已确认退出（local:true）：此后按钮一直保持禁用，直到主进程收尾完成把整页切回登录页。
  const leaving = useRef(false);
  const cooldownUntil = useRef(0);
  const cooldownTimer = useRef<number | undefined>(undefined);
  const [cooling, setCooling] = useState(false);
  useEffect(() => () => { window.clearTimeout(cooldownTimer.current); }, []);

  // 打开菜单时刷新账号档案：后端改了头像/组织名后无需重启应用即可生效。
  const toggle = (): void => {
    if (!open) {
      refresh();
      // 广场由第三方插件可选提供：只有入口按钮确实存在时才给出这一项。
      setPlazaReady(document.querySelector(PLAZA_TRIGGER_SELECTOR) !== null);
    }
    setOpen(!open);
  };

  /**
   * 刷新缓存：重新拉取用户信息（/api/auth/me 每次都会回源后台），
   * 并让宿主重拉闸门策略与资产授权快照：主闸门/子闸门的开关变化立即反映到后续列表与判定，
   * 撤权/授权变更也不用等到下一轮轮询。策略拉取失败会按 failClosed 语义生效，并如实提示失败。
   */
  const refreshCache = async (): Promise<void> => {
    if (cacheBusy) return;
    setCacheBusy(true);
    // 行内先显示蓝色「正在刷新...」，结束后替换为成功/失败标签。
    window.clearTimeout(cacheTimer.current);
    setCacheResult('busy');
    refresh();
    let listOk = false;
    let policyOk = true;
    try {
      const response = await fetch('/api/workdsh-skills', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'refresh-cache', payload: {} }),
        signal: AbortSignal.timeout(30_000),
      });
      const result = response.ok ? await response.json() as {
        ok?: boolean;
        value?: { refreshed?: boolean; policyRefreshed?: boolean };
      } : undefined;
      listOk = result?.ok === true && result.value?.refreshed !== false;
      // 策略拉取失败：宿主已按 failClosed 语义处理，这里必须显示失败而不是「刷新成功」。
      policyOk = result?.ok === true && result.value?.policyRefreshed !== false;
    } catch { listOk = false; policyOk = false; }
    finally { setCacheBusy(false); }
    // 用户需要明确知道刷新有没有生效：成功/失败直接在菜单行内给一个状态标签。
    showCacheResult(!listOk ? 'fail' : policyOk ? 'ok' : 'policy-fail');
  };

  const signOut = async (): Promise<void> => {
    // 请求在途或仍在冷却期内：忽略点击，不发出第二个退出请求。
    if (signingOut.current || Date.now() < cooldownUntil.current) return;
    signingOut.current = true;
    cooldownUntil.current = Date.now() + LOGOUT_COOLDOWN_MS;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(LOGOUT_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('退出登录失败，请重试。');
      const value = await response.json().catch(() => ({})) as { local?: unknown };
      // Desktop 主进程在收到 local:true 后清理会话并切回登录页，页面无需再跳转。
      // 主进程收尾（含后台登出确认）可能还要等待数秒，这期间必须保持按钮禁用：
      // 否则后台卡住时用户仍能继续点击并打出新的退出请求。
      if (value?.local === true) { leaving.current = true; return; }
      window.location.assign('/login');
    } catch (cause) {
      // 主进程已受理退出，后续请求必然失败（会话/回环路由已关闭），不再展示误导性的错误。
      if (leaving.current) return;
      // 网络层失败（fetch 抛 TypeError，如本机服务已停止）统一给中文提示，不直出英文原文。
      setError(cause instanceof TypeError ? '无法连接本机服务，请稍后重试。'
        : cause instanceof Error && cause.message ? cause.message : '退出登录失败，请重试。');
    } finally {
      signingOut.current = false;
      // 已确认退出时保持 busy，直到主进程切换登录页卸载本组件。
      if (!leaving.current) {
        setBusy(false);
        // 失败（例如后端长时间无响应）后仍要冷却一段时间，期间按钮保持禁用。
        const remain = cooldownUntil.current - Date.now();
        if (remain > 0) {
          setCooling(true);
          cooldownTimer.current = window.setTimeout(() => { cooldownTimer.current = undefined; setCooling(false); }, remain);
        }
      }
    }
  };

  return (
    <>
      <style>{accountCss}</style>
      <Menu
        open={open}
        side="top"
        align="start"
        portal
        autoFocus
        className="wd-account-anchor"
        listClassName="wd-account-menu"
        onClose={() => setOpen(false)}
        anchor={(
          <button
            type="button"
            className="wd-account-trigger"
            data-collapsed={!wide}
            aria-label={profile ? '账号' : '设置'}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={toggle}
          >
            {profile
              ? <AccountAvatar profile={profile} size={20} />
              : <span className="wd-account-glyph"><GearIcon /></span>}
            {wide && <span className="wd-account-name">{profile?.displayName ?? '设置'}</span>}
          </button>
        )}
      >
        {profile && (
          <div className="wd-account-header" role="presentation">
            <AccountAvatar profile={profile} size={32} />
            <span className="wd-account-header-text">
              <span className="wd-account-header-name">{profile.displayName}</span>
              {profile.organizationName && <span className="wd-account-header-org">{profile.organizationName}</span>}
            </span>
          </div>
        )}
        <MenuItemButton
          icon={<GearIcon />}
          {...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut })}
          onSelect={() => { setOpen(false); openSettings(); }}
        >
          设置
        </MenuItemButton>
        {desktop && (
          <>
            <MenuItemButton
              icon={<UpdateIcon />}
              onSelect={() => { setOpen(false); window.location.assign(CHECK_UPDATE_PATH); }}
            >
              检查更新
            </MenuItemButton>
            <MenuItemButton
              icon={<LogFileIcon />}
              onSelect={() => { setOpen(false); window.location.assign(DOWNLOAD_LOGS_PATH); }}
            >
              下载运行日志
            </MenuItemButton>
          </>
        )}
        {profile && (
          <MenuItemButton
            icon={<RefreshIcon />}
            disabled={cacheBusy}
            onSelect={() => { void refreshCache(); }}
          >
            <span className="wd-account-cache-row">
              <span>刷新缓存</span>
              {cacheResult && (
                <span
                  role="status"
                  className={`wd-account-cache-result ${cacheResult === 'ok' ? 'ok' : cacheResult === 'busy' ? 'busy' : 'fail'}`}
                  title={cacheResult === 'busy' ? undefined : '点击关闭'}
                  onClick={(event) => {
                    // 行本身是菜单按钮：状态标签不能被当成「再次刷新」。
                    event.stopPropagation();
                    if (cacheResult !== 'busy') dismissCacheResult();
                  }}
                >
                  {cacheResult === 'busy' ? '正在刷新...' : cacheResult === 'ok' ? '刷新成功' : cacheResult === 'policy-fail' ? '授权策略刷新失败' : '刷新失败'}
                </span>
              )}
            </span>
          </MenuItemButton>
        )}
        {/* {plazaReady && (
          <MenuItemButton
            icon={<PlazaIcon />}
            onSelect={() => { setOpen(false); document.querySelector<HTMLButtonElement>(PLAZA_TRIGGER_SELECTOR)?.click(); }}
          >
            插件广场
          </MenuItemButton>
        )} */}
        {profile && (
          <MenuItemButton
            separatorBefore
            danger
            disabled={busy}
            icon={<LogoutIcon />}
            onSelect={() => { setOpen(false); setError(''); setConfirming(true); }}
          >
            退出登录
          </MenuItemButton>
        )}
      </Menu>
      <Modal
        open={confirming}
        title="退出登录"
        closeLabel="关闭"
        description="退出后需要重新输入账号密码才能继续使用，正在运行的任务会中断。"
        onClose={() => { if (!busy) setConfirming(false); }}
        footer={(
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>取消</Button>
            <Button variant="primary" size="sm" disabled={busy || cooling} onClick={() => void signOut()}>{busy ? '正在退出…' : cooling ? '请稍候…' : '退出登录'}</Button>
          </>
        )}
      >
        {error && <p className="wd-account-error" role="alert">{error}</p>}
      </Modal>
    </>
  );
}

const accountCss = `
.wd-account-anchor { display: flex; flex: 1 1 auto; min-width: 0; }
/* 与左侧菜单行（sidebar.panellist 的 panelRow）保持一致：高 36px、内边距 7px 8px、
   圆角 12px、间距 8px、字号 14px/行高 22px、左右各留 2px 外边距。 */
.wd-account-trigger {
  display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0;
  height: 36px; margin: 0 2px; padding: 7px 8px; border: 0; border-radius: 12px; background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer;
}
.wd-account-trigger:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.wd-account-trigger[data-collapsed="true"] { flex: 0 0 auto; width: 36px; margin: 0; padding: 0; justify-content: center; }
.wd-account-glyph { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.wd-account-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wd-account-avatar { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; border-radius: 50%; object-fit: cover; color: #fff; font-weight: 600; }
.wd-account-menu { min-width: 208px; }
/* 刷新缓存：行内状态标签，颜色对齐 ant-design 的 info / success / error。 */
.wd-account-cache-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
.wd-account-cache-result {
  flex: 0 0 auto; padding: 1px 8px; border-radius: 6px;
  border: 1px solid; font-size: 12px; line-height: 18px; cursor: pointer;
}
.wd-account-cache-result.busy { background: #e6f7ff; border-color: #91d5ff; color: #0958d9; cursor: default; }
.wd-account-cache-result.ok { background: #f6ffed; border-color: #b7eb8f; color: #389e0d; }
.wd-account-cache-result.fail { background: #fff2f0; border-color: #ffccc7; color: #cf1322; }
.wd-account-header { display: flex; align-items: center; gap: 10px; padding: 8px 10px 10px; }
.wd-account-header-text { display: grid; gap: 2px; min-width: 0; }
.wd-account-header-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wd-account-header-org { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wd-account-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
`;
