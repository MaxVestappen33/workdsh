/** Carrier appearance and external-account configuration. Independent of deployment-config. */
import { existsSync, readFileSync } from 'node:fs'
import { join, isAbsolute, resolve, dirname } from 'node:path'

export const APP_CONFIG_FILENAME = 'workdsh-app.json'

/** Splash screen copy. All fields are user-editable without repackaging. */
export interface SplashCopy {
  /** Big centig title. */
  title: string
  /** Subtitle below the title. */
  subtitle: string
}

/** External account-service configuration (Jeecg-style backend). */
export interface AccountConfig {
  /** Base origin of the account API, e.g. http://localhost:18080/ytsj-ai */
  baseUrl: string
  /** Relative login path. */
  loginPath: string
  /** Relative logout path. */
  logoutPath: string
}

export interface AppConfig {
  /** Path of the general PNG logo. Absolute, or relative to the config file that declared it. */
  logo: string
  splash: SplashCopy
  account: AccountConfig
}

/** Per-page logo fields. Each page-specific logo falls back to the general `logo`. */
type LogoField = 'logo' | 'loginLogo' | 'splashLogo'

/** A config file that has been read and validated, with the directory its paths resolve against. */
interface ConfigSource {
  parsed: PartialAppConfig
  dir: string
}

const DEFAULTS: AppConfig = {
  logo: 'logo.png',
  splash: {
    title: '环境准备中',
    subtitle: '正在准备好你的工作区，请稍候...',
  },
  account: {
    baseUrl: 'http://127.0.0.1:18080/ytsj-ai',
    loginPath: '/sys/login',
    logoutPath: '/sys/logout',
  },
}

/** Partially-declared appearance/account overrides merged over the defaults. */
type PartialAppConfig = {
  logo?: string
  loginLogo?: string
  splashLogo?: string
  splash?: Partial<SplashCopy>
  account?: Partial<AccountConfig>
}

/** Highest-priority declared value for the first matching field, override files first. */
function pickLogo(sources: ConfigSource[], fields: LogoField[]): { value: string, dir: string } | undefined {
  for (const field of fields) {
    for (const source of sources) {
      const value = source.parsed[field]
      if (typeof value === 'string' && value.length > 0) return { value, dir: source.dir }
    }
  }
  return undefined
}

/** Validate the appearance/account input. Only safe display and endpoint values are accepted. */
export function parseAppConfig(value: unknown): PartialAppConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('应用外观配置必须是 JSON 对象')
  const root = value as Record<string, unknown>
  const result: PartialAppConfig = {}
  const logoFields: LogoField[] = ['logo', 'loginLogo', 'splashLogo']
  for (const key of Object.keys(root)) {
    if (key !== 'logo' && key !== 'loginLogo' && key !== 'splashLogo' && key !== 'splash' && key !== 'account') throw new Error(`应用外观配置不接受字段 ${key}`)
  }
  for (const field of logoFields) {
    const raw = root[field]
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${field} 必须是文件路径字符串`)
      result[field] = raw
    }
  }
  if (root.splash !== undefined) {
    if (!root.splash || typeof root.splash !== 'object' || Array.isArray(root.splash)) throw new Error('splash 配置无效')
    const s = root.splash as Record<string, unknown>
    if (s.title !== undefined) { if (typeof s.title !== 'string') throw new Error('splash.title 必须是字符串'); result.splash = { ...(result.splash ?? {}), title: s.title } }
    if (s.subtitle !== undefined) { if (typeof s.subtitle !== 'string') throw new Error('splash.subtitle 必须是字符串'); result.splash = { ...(result.splash ?? {}), subtitle: s.subtitle } }
  }
  if (root.account !== undefined) {
    if (!root.account || typeof root.account !== 'object' || Array.isArray(root.account)) throw new Error('account 配置无效')
    const a = root.account as Record<string, unknown>
    for (const k of Object.keys(a)) if (k !== 'baseUrl' && k !== 'loginPath' && k !== 'logoutPath') throw new Error(`account 配置不接受字段 ${k}`)
    if (a.baseUrl !== undefined) {
      if (typeof a.baseUrl !== 'string') throw new Error('account.baseUrl 必须是字符串')
      result.account = { ...(result.account ?? {}), baseUrl: normalizeBase(a.baseUrl) }
    }
    if (a.loginPath !== undefined) { if (typeof a.loginPath !== 'string' || !/^\//u.test(a.loginPath)) throw new Error('account.loginPath 必须以 / 开头'); result.account = { ...(result.account ?? {}), loginPath: a.loginPath } }
    if (a.logoutPath !== undefined) { if (typeof a.logoutPath !== 'string' || !/^\//u.test(a.logoutPath)) throw new Error('account.logoutPath 必须以 / 开头'); result.account = { ...(result.account ?? {}), logoutPath: a.logoutPath } }
  }
  return result
}

export interface ResolvedAppConfig {
  /** Absolute path of the general logo; both pages fall back to it. */
  logoPath: string
  /** Absolute path of the logo shown on the login page. */
  loginLogoPath: string
  /** Absolute path of the logo shown on the splash page. */
  splashLogoPath: string
  splash: SplashCopy
  account: AccountConfig
}

function readConfigFile(file: string): ConfigSource {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8')) as unknown
  return { parsed: parseAppConfig(raw), dir: dirname(file) }
}

/**
 * Resolve the effective carrier config. Packaged `Resources/workdsh-app.json` provides
 * the default; a `userData/workdsh-app.json` override wins. Each logo may be absolute or
 * relative to the file that declared it; login/splash fall back to the general `logo`.
 */
export function readAppConfig(resources: string, userData: string): ResolvedAppConfig {
  const packagedFile = join(resources, APP_CONFIG_FILENAME)
  const overrideFile = join(userData, APP_CONFIG_FILENAME)
  const packaged = existsSync(packagedFile) ? readConfigFile(packagedFile) : undefined
  const override = existsSync(overrideFile) ? readConfigFile(overrideFile) : undefined
  // Override first, then packaged: the first declared value wins per field.
  const sources = [override, packaged].filter((source): source is ConfigSource => source !== undefined)

  const splash: SplashCopy = { ...DEFAULTS.splash, ...packaged?.parsed.splash, ...override?.parsed.splash }
  // Base URL may be supplied by the admin via WORKDSH_ACCOUNT_BASE environment, else config.
  const accountBase = process.env.WORKDSH_ACCOUNT_BASE ?? override?.parsed.account?.baseUrl ?? packaged?.parsed.account?.baseUrl ?? DEFAULTS.account.baseUrl
  const account: AccountConfig = {
    ...DEFAULTS.account,
    ...packaged?.parsed.account,
    ...override?.parsed.account,
    ...(accountBase ? { baseUrl: normalizeBase(accountBase) } : {}),
  }
  const resolveLogo = (fields: LogoField[]): string => {
    const hit = pickLogo(sources, fields)
    if (!hit) return resolve(resources, DEFAULTS.logo)
    return isAbsolute(hit.value) ? hit.value : resolve(hit.dir || resources, hit.value)
  }
  return {
    logoPath: resolveLogo(['logo']),
    loginLogoPath: resolveLogo(['loginLogo', 'logo']),
    splashLogoPath: resolveLogo(['splashLogo', 'logo']),
    splash,
    account,
  }
}

function normalizeBase(value: string): string {
  const url = new URL(value.includes('://') ? value : `http://${value}`)
  return url.origin + url.pathname.replace(/\/+$/u, '')
}