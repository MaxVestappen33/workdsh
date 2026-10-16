import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';

export const connectorDefinitionSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(80),
  description: z.string().max(240),
  serverName: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  transport: z.enum(['stdio', 'streamable-http']),
  command: z.string().max(1024).optional(),
  args: z.array(z.string().max(4096)).max(64).optional(),
  url: z.string().url().max(2048).optional(),
  authorizationCredentialRef: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).max(128).optional(),
  /** 市场分类名称（安装时取市场 bizSceneList 文案，多值全部保留），落盘供「我的本地 MCP」展示与按分类筛选。自建实例为 undefined。 */
  categories: z.array(z.string().min(1).max(64)).max(8).optional(),
  /** 来源市场条目 id。存在即表示该实例由市场安装而来，用于「已安装」判定与卸载。 */
  originId: z.string().max(128).optional(),
  enabled: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type ConnectorDefinition = z.infer<typeof connectorDefinitionSchema>;

export const connectorSelectionSchema = z.object({
  sessionId: z.string().min(1),
  connectorIds: z.array(z.string().min(1).max(64)).max(32),
  updatedAt: z.string().min(1),
});

export type ConnectorSelection = z.infer<typeof connectorSelectionSchema>;

export const connectorsDomainSpec = defineDomain({
  name: 'workdsh_connectors', version: 1, layout: 'per-record',
  global: { schema: z.object({ seededExample: z.boolean() }), initial: { seededExample: false } },
  tables: { definitions: domainTable<string, ConnectorDefinition>(connectorDefinitionSchema) },
});

/** Session choices have an independent lifecycle from installed MCP definitions. */
export const connectorSelectionsDomainSpec = defineDomain({
  name: 'workdsh_connector_selections', version: 1, layout: 'per-record',
  global: { schema: z.object({}), initial: {} },
  tables: { selections: domainTable<string, ConnectorSelection>(connectorSelectionSchema) },
});
