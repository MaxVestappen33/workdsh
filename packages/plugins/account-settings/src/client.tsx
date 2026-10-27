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
/** SkillHub 广场的入口按钮：侧栏展示已由 WorkDSH 隐藏，改由本菜单触发同一个广场。 */
const PLAZA_TRIGGER_SELECTOR = '.sh-plaza-trigger';

/** 账号档案：不可用时整体为 undefined，入口退化为官方回退的「设置」外观。 */
type AccountProfile = {
  readonly displayName: string;
  readonly organizationName?: string;
  readonly avatar?: string;
};

export function apply(ctx: Context): void {
  // 官方 ui-settings-account 的账号菜单只在注入 dshDesktop 的官方壳里注册（其 apply 首行判定），
  // WorkDSH 载体不注入该标记。这里保持同一条判定：两者互斥，不会争抢这个单槽位。
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

/** 桌面载体的窄通道：工作台里用一次 workdsh:// 导航触发检查更新，不往官方页面注入桥。 */
const CHECK_UPDATE_PATH = 'workdsh://check-update';

/** 侧栏底部入口：账号可用时为头像 + 姓名，否则复用官方「设置」外观。 */
function AccountLauncher({ wide, settingsShortcut, openSettings }: PropsRuntime<'settings.launcher'>) {
  const { profile, desktop, refresh } = useAccountProfile();
  const [open, setOpen] = useState(false);
  const [plazaReady, setPlazaReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 打开菜单时刷新账号档案：后端改了头像/组织名后无需重启应用即可生效。
  const toggle = (): void => {
    if (!open) {
      refresh();
      // 广场由第三方插件可选提供：只有入口按钮确实存在时才给出这一项。
      setPlazaReady(document.querySelector(PLAZA_TRIGGER_SELECTOR) !== null);
    }
    setOpen(!open);
  };

  const signOut = async (): Promise<void> => {
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
      if (value?.local === true) return;
      window.location.assign('/login');
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '退出登录失败，请重试。');
    } finally {
      setBusy(false);
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
          <MenuItemButton
            icon={<UpdateIcon />}
            onSelect={() => { setOpen(false); window.location.assign(CHECK_UPDATE_PATH); }}
          >
            检查更新
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
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void signOut()}>{busy ? '正在退出…' : '退出登录'}</Button>
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
.wd-account-header { display: flex; align-items: center; gap: 10px; padding: 8px 10px 10px; }
.wd-account-header-text { display: grid; gap: 2px; min-width: 0; }
.wd-account-header-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wd-account-header-org { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wd-account-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
`;
