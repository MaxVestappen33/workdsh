/** Carrier appearance and backend-platform server configuration. Independent of deployment-config. */
import { existsSync, readFileSync } from 'node:fs'
import { join, isAbsolute, resolve, dirname } from 'node:path'

export const APP_CONFIG_FILENAME = 'workdsh-app.json'

/**
 * 运行环境。仅 dev 打开调试日志（Host 出站 HTTP、Host 原始输出落盘），
 * prod 下这些日志完全不产生，避免内网机器长期写入敏感数据。
 */
export type AppEnvironment = 'dev' | 'prod'

/** Splash screen copy. All fields are user-editable without repackaging. */
export interface SplashCopy {
  /** Big cent title. */
  title: string
  /** Subtitle below the title. */
  subtitle: string
}

/** 后台管理平台（服务器）API 配置：登录、退出等接口都挂在这个地址下。 */
export interface ServerConfig {
  /** API 根地址，例如 http://localhost:18080/ytsj-ai */
  baseUrl: string
  /** Relative login path. */
  loginPath: string
  /** Relative logout path. */
  logoutPath: string
  /** 会话校验 + 用户信息刷新接口路径（账号模式运行中轮询）。 */
  mePath: string
  /** 运行中后台校验的轮询间隔（秒）。 */
  syncIntervalSeconds: number
  /** MCP 市场：列表接口路径。 */
  mcpMarketListPath: string
  /** MCP 市场：分类字典接口路径。 */
  mcpMarketCategoriesPath: string
  /** MCP 市场：安装上报接口路径。 */
  mcpMarketInstallPath: string
  /** MCP 市场：卸载上报接口路径。 */
  mcpMarketUninstallPath: string
  /** 技能市场：已授权技能列表接口路径。 */
  skillMarketListPath: string
  /** 技能市场：业务场景字典接口路径。 */
  skillMarketCategoriesPath: string
  /** 技能市场：安装接口路径（后台当前为预留实现，只记录安装行为）。 */
  skillMarketInstallPath: string
  /** 技能市场：卸载接口路径（后台当前为预留实现，只记录卸载行为）。 */
  skillMarketUninstallPath: string
  /** 技能上架申请：提交接口路径。 */
  skillListingSubmitPath: string
  /** 技能上架申请：我的申请列表接口路径。 */
  skillListingListPath: string
  /** 技能上架申请：来源节点列表接口路径。 */
  skillListingNodePath: string
  /** 技能上架申请：业务场景树接口路径。 */
  skillListingScenePath: string
  /** 通用字典前缀：实际请求为 `${skillDictPath}/{dictCode}`。 */
  skillDictPath: string
  /** 通用文件上传接口路径（multipart，免签）。 */
  skillUploadPath: string
  /** 模型市场：已授权模型列表接口路径。 */
  modelMarketListPath: string
  /** 模型市场：使用模型上报接口路径（后台当前为预留实现）。 */
  modelMarketUsePath: string
  /** 模型市场：卸载模型上报接口路径（后台当前为预留实现）。 */
  modelMarketUnusePath: string
  /** 专家市场：已授权专家（个人）列表接口路径。 */
  expertMarketAgentListPath: string
  /** 专家市场：已授权专家团列表接口路径。 */
  expertMarketTeamListPath: string
  /** 专家上架申请：我的申请列表（个人专家）接口路径。 */
  expertMyListingAgentPath: string
  /** 专家上架申请：我的申请列表（专家团）接口路径。 */
  expertMyListingTeamPath: string
  /** 专家上架申请：提交（个人专家）接口路径。 */
  expertListingSubmitAgentPath: string
  /** 专家上架申请：提交（专家团）接口路径。 */
  expertListingSubmitTeamPath: string
  /** 专家上架申请：撤回（个人专家）接口路径。 */
  expertListingWithdrawAgentPath: string
  /** 专家上架申请：撤回（专家团）接口路径。 */
  expertListingWithdrawTeamPath: string
  /** 用户反馈：新增接口路径（提交分类与详情）。 */
  feedbackAddPath: string
  /** 正在使用的客户端发布接口路径（相对 baseUrl）。 */
  latestVersionPath: string
  /** 发布记录中的应用标识，与服务端表 app_id 对应。 */
  appId: string
  /** 自动检查更新的间隔（分钟），默认 360。 */
  updateCheckIntervalMinutes: number
  /** 是否启用客户端在线更新；默认启用。 */
  updateEnabled: boolean
  /** 内网 npm registry 基址（Sonatype Nexus），用于离线安装基于 stdio 的 npm MCP；未配置表示该部署不支持本机包安装。 */
  mcpPackageRegistry?: string
}

export interface AppConfig {
  /** Path of the general PNG logo. Absolute, or relative to the config file that declared it. */
  logo: string
  /** 运行环境开关：dev 打开调试日志，默认 prod。 */
  environment: AppEnvironment
  splash: SplashCopy
  server: ServerConfig
}

/** Per-page logo fields. Each page-specific logo falls back to the general `logo`. */
type LogoField = 'logo' | 'loginLogo' | 'splashLogo'

/** A config file that has been read and validated, with the directory its paths resolve against. */
interface ConfigSource {
  parsed: PartialAppConfig
  dir: string
}

/**
 * 代码内置的缺省值，也是接口路径的唯一维护点：随包 workdsh-app.json 只保留部署差异
 * 与运维可调项（appId、会话校验间隔、在线更新开关），不再重复声明与这里相同的接口路径
 * （由 tests/app-config.spec.ts 锁定）。
 */
export const APP_CONFIG_DEFAULTS: AppConfig = {
  logo: 'logo.png',
  environment: 'prod',
  splash: {
    title: '环境准备中',
    subtitle: '正在准备好您的工作区，请稍候...',
  },
  server: {
    /** 版本发布记录中的应用标识（后台表 app_id）：决定向后台查询哪一条客户端发布记录。 */
    appId: 'police-assistant',
    /** 后台管理平台根地址；运行时还会被 WORKDSH_SERVER_BASE 环境变量覆盖。 */
    baseUrl: 'http://127.0.0.1:18080/ytsj-ai',
    /** 自动检查更新的间隔，单位「分钟」：360 分钟 = 6 小时检查一次（允许 5-10080）。 */
    updateCheckIntervalMinutes: 5,
    /** 账号模式运行中校验会话的轮询间隔，单位「秒」：300 秒一次（允许 1-3600）。 */
    syncIntervalSeconds: 300,
    /** 是否启用客户端在线更新：false 时完全不检查、不提示新版本。 */
    updateEnabled: true,
    /** 登录接口路径。 */
    loginPath: '/sys/pcClientLogin',
    /** 注销接口路径。 */
    logoutPath: '/sys/logout',
    /** 获取当前登录用户信息接口路径。 */
    mePath: '/sys/pcClientVerifyUser',
    /** 四个市场接口都在 desktop-client 命名空间；安装不再从后台取连接配置（连接字段全部来自市场列表）。 */
    mcpMarketListPath: '/desktop-client/mcptool/queryAuthorizedMcpToolList',
    mcpMarketCategoriesPath: '/desktop-client/mcptool/queryMcpToolBizSceneList',
    mcpMarketInstallPath: '/desktop-client/mcptool/installMcpTool',
    mcpMarketUninstallPath: '/desktop-client/mcptool/unInstallMcpTool',
    /** 技能市场的查询与安装/卸载接口与 MCP 市场同属 desktop-client 命名空间。 */
    skillMarketListPath: '/desktop-client/skill/queryAuthorizedSkillList',
    skillMarketCategoriesPath: '/desktop-client/skill/querySkillBizSceneList',
    skillMarketInstallPath: '/desktop-client/skill/installSkill',
    skillMarketUninstallPath: '/desktop-client/skill/unInstallSkill',
    /** 技能上架申请与表单字典：同属 desktop-client 命名空间，上传接口免签。 */
    skillListingSubmitPath: '/desktop-client/skill/listingRequest',
    skillListingListPath: '/desktop-client/skill/queryMyListingSkillList',
    skillListingNodePath: '/desktop-client/queryAiNodeList',
    skillListingScenePath: '/desktop-client/queryAiBizSceneList',
    skillDictPath: '/desktop-client/getDictItems',
    skillUploadPath: '/desktop-client/upload',
    /** 模型市场与技能/MCP 市场同属 desktop-client 命名空间；安装与卸载只做后台上报。 */
    modelMarketListPath: '/desktop-client/model/queryAuthorizedModelList',
    modelMarketUsePath: '/desktop-client/model/useModel',
    modelMarketUnusePath: '/desktop-client/model/unUseModel',
    /** 专家目录、上架申请与撤回都在 desktop-client 命名空间，个人专家与专家团各一套端点。 */
    expertMarketAgentListPath: '/desktop-client/expert/queryAuthorizedExpertList',
    expertMarketTeamListPath: '/desktop-client/expertgroup/queryAuthorizedExpertGroupList',
    expertMyListingAgentPath: '/desktop-client/expert/queryMyListingExpertList',
    expertMyListingTeamPath: '/desktop-client/expertgroup/queryMyListingExpertGroupList',
    expertListingSubmitAgentPath: '/desktop-client/expert/listingRequest',
    expertListingSubmitTeamPath: '/desktop-client/expertgroup/listingRequest',
    expertListingWithdrawAgentPath: '/desktop-client/expert/withdrawListingRequest',
    expertListingWithdrawTeamPath: '/desktop-client/expertgroup/withdrawListingRequest',
    /** 用户反馈新增接口：官方反馈弹窗提交的分类与详情经宿主转发到这里。 */
    feedbackAddPath: '/desktop-client/feedback/add',
    /** 客户端版本检查与后台版本管理表共用 desktop-client 命名空间。 */
    latestVersionPath: '/desktop-client/queryLatestVersionApp',
  },
}

/** Partially-declared appearance/server overrides merged over the defaults. */
type PartialAppConfig = {
  logo?: string
  loginLogo?: string
  splashLogo?: string
  environment?: AppEnvironment
  splash?: Partial<SplashCopy>
  server?: Partial<ServerConfig>
}

/** 所有相对接口路径字段：统一要求以单个 `/` 开头，避免协议相对地址或外站路径。 */
export const SERVER_PATH_FIELDS = [
  'loginPath', 'logoutPath', 'mePath',
  'mcpMarketListPath', 'mcpMarketCategoriesPath', 'mcpMarketInstallPath', 'mcpMarketUninstallPath',
  'skillMarketListPath', 'skillMarketCategoriesPath', 'skillMarketInstallPath', 'skillMarketUninstallPath',
  'skillListingSubmitPath', 'skillListingListPath', 'skillListingNodePath', 'skillListingScenePath',
  'skillDictPath', 'skillUploadPath',
  'modelMarketListPath', 'modelMarketUsePath', 'modelMarketUnusePath',
  'expertMarketAgentListPath', 'expertMarketTeamListPath',
  'expertMyListingAgentPath', 'expertMyListingTeamPath',
  'expertListingSubmitAgentPath', 'expertListingSubmitTeamPath',
  'expertListingWithdrawAgentPath', 'expertListingWithdrawTeamPath',
  'feedbackAddPath',
  'latestVersionPath',
] as const

/** server 段中非路径的标量字段，各自有独立校验。 */
const SERVER_SCALAR_FIELDS = ['baseUrl', 'appId', 'updateCheckIntervalMinutes', 'updateEnabled', 'syncIntervalSeconds', 'mcpPackageRegistry'] as const

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
    if (key !== 'logo' && key !== 'loginLogo' && key !== 'splashLogo' && key !== 'environment' && key !== 'splash' && key !== 'server') throw new Error(`应用外观配置不接受字段 ${key}`)
  }
  if (root.environment !== undefined) {
    if (root.environment !== 'dev' && root.environment !== 'prod') throw new Error('environment 只能是 dev 或 prod')
    result.environment = root.environment
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
  if (root.server !== undefined) {
    if (!root.server || typeof root.server !== 'object' || Array.isArray(root.server)) throw new Error('server 配置无效')
    const a = root.server as Record<string, unknown>
    const known = new Set<string>([...SERVER_PATH_FIELDS, ...SERVER_SCALAR_FIELDS])
    for (const k of Object.keys(a)) if (!known.has(k)) throw new Error(`server 配置不接受字段 ${k}`)
    if (a.baseUrl !== undefined) {
      if (typeof a.baseUrl !== 'string') throw new Error('server.baseUrl 必须是字符串')
      result.server = { ...(result.server ?? {}), baseUrl: normalizeBase(a.baseUrl) }
    }
    for (const k of SERVER_PATH_FIELDS) {
      const raw = a[k]
      if (raw === undefined) continue
      // 所有端点都拼在 baseUrl 之后，必须是单个 / 开头的相对路径。
      if (typeof raw !== 'string' || !/^\/(?!\/)/u.test(raw)) throw new Error(`server.${k} 必须以单个 / 开头`)
      result.server = { ...(result.server ?? {}), [k]: raw }
    }
    if (a.appId !== undefined) { if (typeof a.appId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(a.appId)) throw new Error('server.appId 只能使用小写字母、数字、点、短横线'); result.server = { ...(result.server ?? {}), appId: a.appId } }
    if (a.updateCheckIntervalMinutes !== undefined) {
      // 5 分钟到 7 天：过短会给后台造成无意义压力，过长会让补丁迟迟不到位。
      if (typeof a.updateCheckIntervalMinutes !== 'number' || !Number.isInteger(a.updateCheckIntervalMinutes) || a.updateCheckIntervalMinutes < 5 || a.updateCheckIntervalMinutes > 10080) throw new Error('server.updateCheckIntervalMinutes 必须是 5-10080 的整数')
      result.server = { ...(result.server ?? {}), updateCheckIntervalMinutes: a.updateCheckIntervalMinutes }
    }
    if (a.updateEnabled !== undefined) { if (typeof a.updateEnabled !== 'boolean') throw new Error('server.updateEnabled 必须是布尔值'); result.server = { ...(result.server ?? {}), updateEnabled: a.updateEnabled } }
    if (a.mcpPackageRegistry !== undefined) { if (typeof a.mcpPackageRegistry !== 'string' || !/^https?:\/\//u.test(a.mcpPackageRegistry)) throw new Error('server.mcpPackageRegistry 必须是 http(s) 地址'); result.server = { ...(result.server ?? {}), mcpPackageRegistry: a.mcpPackageRegistry } }
    if (a.syncIntervalSeconds !== undefined) {
      // 轮询间隔需为正整数秒，且不超过 1 小时，避免配置错误导致请求风暴或长期不校验。
      if (typeof a.syncIntervalSeconds !== 'number' || !Number.isInteger(a.syncIntervalSeconds) || a.syncIntervalSeconds < 1 || a.syncIntervalSeconds > 3600) throw new Error('server.syncIntervalSeconds 必须是 1-3600 的整数')
      result.server = { ...(result.server ?? {}), syncIntervalSeconds: a.syncIntervalSeconds }
    }
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
  /** 运行环境：dev 时载体与 Host 打开调试日志。 */
  environment: AppEnvironment
  splash: SplashCopy
  server: ServerConfig
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

  const splash: SplashCopy = { ...APP_CONFIG_DEFAULTS.splash, ...packaged?.parsed.splash, ...override?.parsed.splash }
  // 后台平台地址可由管理员经 WORKDSH_SERVER_BASE 环境变量提供，否则取配置文件。
  const serverBase = process.env.WORKDSH_SERVER_BASE ?? override?.parsed.server?.baseUrl ?? packaged?.parsed.server?.baseUrl ?? APP_CONFIG_DEFAULTS.server.baseUrl
  const server: ServerConfig = {
    ...APP_CONFIG_DEFAULTS.server,
    ...packaged?.parsed.server,
    ...override?.parsed.server,
    ...(serverBase ? { baseUrl: normalizeBase(serverBase) } : {}),
  }
  const resolveLogo = (fields: LogoField[]): string => {
    const hit = pickLogo(sources, fields)
    if (!hit) return resolve(resources, APP_CONFIG_DEFAULTS.logo)
    return isAbsolute(hit.value) ? hit.value : resolve(hit.dir || resources, hit.value)
  }
  return {
    logoPath: resolveLogo(['logo']),
    loginLogoPath: resolveLogo(['loginLogo', 'logo']),
    splashLogoPath: resolveLogo(['splashLogo', 'logo']),
    environment: override?.parsed.environment ?? packaged?.parsed.environment ?? APP_CONFIG_DEFAULTS.environment,
    splash,
    server,
  }
}

function normalizeBase(value: string): string {
  const url = new URL(value.includes('://') ? value : `http://${value}`)
  return url.origin + url.pathname.replace(/\/+$/u, '')
}