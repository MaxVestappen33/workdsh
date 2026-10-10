import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 随包交付的默认模型访问值文件名（与 workdsh-config.json 并列，位于应用 Resources 下）。 */
export const MODEL_CREDENTIALS_FILENAME = 'model-credentials.json'

/**
 * 引用名语法与官方凭据 seam 的 `REF_PATTERN` 一致（POSIX shell 标识符）。
 * 不匹配的名字在运行时会被 credentialRef() 直接拒绝，因此在打包期就拦下。
 */
const REFERENCE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u

/**
 * 校验随包的「apiKeyEnv 引用名 → 值」映射。
 * 该文件承载的是**非机密**的默认模型访问值：由部署环境在网关/IP 层校验，
 * 能访问该模型的服务共用同一个值，所以允许随安装包分发、让用户开箱即用。
 * 真正的机密凭据仍只应走启动环境变量或 $DSH_HOME/.credentials.yaml。
 * 值为空串表示「尚未提供」：仓库内的模板在填入真实值之前也能安全启动。
 */
export function parseModelCredentials(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型访问配置必须是 JSON 对象')
  const result: Record<string, string> = {}
  for (const [name, secret] of Object.entries(value as Record<string, unknown>)) {
    if (!REFERENCE_NAME.test(name)) throw new Error(`模型访问配置的引用名必须是 POSIX 标识符：${name}`)
    if (typeof secret !== 'string') throw new Error(`模型访问配置 ${name} 的值必须是字符串`)
    if (secret.trim() === '') continue
    result[name] = secret
  }
  return result
}

/**
 * 读取随包的模型访问配置。
 * 文件缺失表示该构建不预置默认模型访问值（返回空对象）；文件本身非法则抛出。
 * 启动环境已显式提供的同名变量优先，文件值只作兜底——与官方凭据解析
 * 「继承的进程环境变量 > $DSH_HOME/.credentials.yaml > .env」的优先级一致。
 */
export function readModelCredentials(resources: string, environment: NodeJS.ProcessEnv = {}): Record<string, string> {
  const file = join(resources, MODEL_CREDENTIALS_FILENAME)
  if (!existsSync(file)) return {}
  const parsed = parseModelCredentials(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  return Object.fromEntries(Object.entries(parsed).filter(([name]) => environment[name] === undefined))
}
