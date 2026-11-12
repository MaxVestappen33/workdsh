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
  // 不影响插件加载。接口路径与本机包安装能力都由宿主经插件选项注入（未配置时回退到内置默认值 / 不支持本机安装）。
  await ctx.plugin(ConnectorMarketService, { paths: options.paths, install: options.install, clientId: options.clientId });
  await ctx.plugin({
    name: 'workdsh-connectors-integration',
    inject: [...inject, 'workdshConnectors'],
    apply: (host: Context) => {
      // 一次性回填：为旧记录补写安装清单。幂等、失败不阻断启动，只记日志与条数。
      // 服务由本 Fiber 的 inject 提供，不能在父 Fiber 里直接读 ctx.workdshConnectors。
      void host.workdshConnectors.backfillInstallManifests().then(result => {
        if (result.written || result.failed) {
          host.logger.info(`连接器：安装清单回填完成（扫描 ${result.scanned}，写入 ${result.written}，失败 ${result.failed}）。`);
        }
      }).catch(error => {
        host.logger.warn(`连接器：安装清单回填中断：${error instanceof Error ? error.message : String(error)}。`);
      });
      registerConnectorManagementConnection(host);
    },
  });
}
