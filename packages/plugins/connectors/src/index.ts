import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-mcp-resources';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-storage-domain';
import { registerConnectorManagementConnection } from './connection-api.js';
import { ConnectorManager, type ConnectorManagerOptions } from './manager.js';
import { ConnectorMarketService, type ConnectorMarketOptions } from './market-entry.js';

export * from './shared.js';
export * from './connection-api.js';
export * from './manager.js';
export * from './market.js';
export * from './market-entry.js';
export const name = 'workdsh-plugin-connectors';
export const inject = ['connection', 'tools', 'mcpResources', 'storageDomain', 'agents', 'credentials', 'workdshSessionAccess'];

export interface ConnectorPluginOptions extends ConnectorManagerOptions, ConnectorMarketOptions {}

export async function apply(ctx: Context, options: ConnectorPluginOptions = {}): Promise<void> {
  await ctx.plugin(ConnectorManager, options);
  // MCP 市场依赖宿主提供的通用后台通道（workdshBackend）；通道或绑定缺失时市场整体不可用，
  // 不影响插件加载。接口路径仍由宿主经插件选项注入（未配置时回退到内置默认值）。
  await ctx.plugin(ConnectorMarketService, { paths: options.paths });
  await ctx.plugin({
    name: 'workdsh-connectors-integration',
    inject: [...inject, 'workdshConnectors'],
    apply: registerConnectorManagementConnection,
  });
}
