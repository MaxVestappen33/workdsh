import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { APP_CONFIG_DEFAULTS, SERVER_PATH_FIELDS, parseAppConfig, readAppConfig } from '../src/app-config.ts'

/** 随包资源目录：workdsh-app.json 从这里分发到安装包。 */
const resources = fileURLToPath(new URL('../resources/', import.meta.url))
const packaged: unknown = JSON.parse(readFileSync(join(resources, 'workdsh-app.json'), 'utf8'))
/** 不存在的用户级覆盖目录：确保只读取随包配置。 */
const missingUserData = join(resources, 'missing-user-data')

it('随包 workdsh-app.json 不重复声明接口路径', () => {
  const declared = Object.keys(parseAppConfig(packaged).server ?? {})
  // 接口路径只在 app-config.ts 的 APP_CONFIG_DEFAULTS 维护；随包配置再写一遍等于双份维护。
  expect(declared.filter(key => (SERVER_PATH_FIELDS as readonly string[]).includes(key))).toEqual([])
})

it('精简后所有接口路径仍回退到 app-config.ts 的唯一缺省值', () => {
  const resolved = readAppConfig(resources, missingUserData)
  for (const key of SERVER_PATH_FIELDS) expect(resolved.server[key]).toBe(APP_CONFIG_DEFAULTS.server[key])
})

it('随包配置保留部署差异项', () => {
  const resolved = readAppConfig(resources, missingUserData)
  expect(resolved.environment).toBe('dev')
  expect(resolved.server.syncIntervalSeconds).toBe(300)
  expect(resolved.server.mcpPackageRegistry).toBe('http://56.82.7.213:8081/repository/npm-group/')
  expect(resolved.splash.subtitle).toBe('正在准备好您的工作区，请稍候...')
  expect(resolved.loginLogoPath.endsWith('login-logo.png')).toBe(true)
  expect(resolved.splashLogoPath.endsWith('splash-logo.png')).toBe(true)
})

it('随包配置保留运维可调项（appId、会话校验间隔、在线更新开关）', () => {
  const server = parseAppConfig(packaged).server
  expect(server?.appId).toBe('police-assistant')
  expect(server?.syncIntervalSeconds).toBe(300)
  expect(server?.updateCheckIntervalMinutes).toBe(5)
  expect(server?.updateEnabled).toBe(true)
})
