import { enterpriseConnection } from './connection-mode.ts'

export type DeploymentConfig = { enterprise?: { backendUrl: string } }

/** Administrator-owned packaging input. Never accepts credentials or arbitrary settings. */
export function parseDeploymentConfig(value: unknown): DeploymentConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('打包配置必须是 JSON 对象')
  const root = value as Record<string, unknown>
  if (Object.keys(root).some(key => key !== 'enterprise')) throw new Error('打包配置仅允许 enterprise 后台地址，不接受密钥或其他设置')
  if (root.enterprise === undefined) return {}
  if (!root.enterprise || typeof root.enterprise !== 'object' || Array.isArray(root.enterprise)) throw new Error('enterprise 配置必须包含 backendUrl')
  const enterprise = root.enterprise as Record<string, unknown>
  if (Object.keys(enterprise).some(key => key !== 'backendUrl') || typeof enterprise.backendUrl !== 'string') {
    throw new Error('enterprise 配置仅允许 backendUrl，不接受账号或密钥')
  }
  return { enterprise: { backendUrl: enterpriseConnection(enterprise.backendUrl).portalOrigin } }
}
