/**
 * MCP 兼容层：服务端实现差异 → 官方 MCP 客户端。
 *
 * 服务端短期无法修改的问题都在这一层用最小改动兜住，只处理下面两类，其余请求原样透传
 * （不复制、不缓冲、不影响流式响应）：
 *
 * 1. **空游标**：规范里 `nextCursor` 只要**出现**就表示「还有下一页」。部分服务端在没有下一页时仍下发
 *    `nextCursor: ""`（个别是 `null`），官方客户端会因此按游标再取一页，把同一批工具重复追加进聚合结果；
 *    官方 MCP 客户端插件随后按工具名判重并抛 `server listed tool "..." more than once — invalid tool list`，
 *    整条连接被判定失败（界面提示 `initial connection or tool synchronization failed`）。
 *    这里只对 JSON-RPC 的列表方法、且响应体确实带空游标时，复制响应并删掉该字段。
 *
 * 2. **协议时代误报（discover 撒谎）**：客户端用 `server/discover` 探测协议版本，探测通过就直接按现代
 *    （envelope）时代建连、跳过 initialize。部分网关（如 ModelScope 托管服务）会照常应答 discover 并声明
 *    支持现代版本，但真实数据面只服务握手（handshake）时代，随后任何带现代信封的 `tools/list` 都被
 *    `-32600 this connection serves the handshake protocol era…` 拒绝，表现为首次工具同步失败。
 *    SDK 自身不做「时代不匹配 → 回退握手」的降级，因此这里补上：某地址被证实只服务握手时代后，
 *    后续对它的 `server/discover` 直接回 `-32601 Method not found`，SDK 会自然回退到 initialize 握手。
 *    判定与重试由调用方（manager 的建连流程）驱动，见 `isProtocolEraMismatch` / `forceLegacyProtocol`。
 *
 * 服务端按规范省略空游标、以及修正 discover 声明后，上述分支都不会被触发，可随时删除。
 */
/** 官方客户端会对这些列表方法的 `nextCursor` 翻页。 */
const LIST_METHODS: readonly string[] = ['tools/list', 'resources/list', 'resources/templates/list', 'prompts/list'];
/** 只检查小请求体：MCP 列表请求都很短，避免为模型调用等大 POST 体做多余的 JSON 解析。 */
const MAX_INSPECT_BYTES = 8 * 1024;
/** 协议版本探测方法：命中即被本层接管（仅限已判定为握手时代的地址）。 */
const DISCOVER_METHOD = 'server/discover';
/** 远端拒绝现代信封时的报错特征。 */
const ERA_MISMATCH_PATTERN = /handshake protocol era|envelope are not accepted/i;
/** 进程级安装标记：重复安装时沿用已有包装，不叠加。 */
const INSTALLED = Symbol.for('workdsh.connectors.mcpCompat');

type CompatScope = typeof globalThis & { [INSTALLED]?: () => void };

/**
 * 已被证实「只服务握手时代」的服务地址（`origin + pathname`）。
 * 进程级缓存：同一次运行里同地址只试错一次，重连时直接走握手时代。
 */
const LEGACY_ONLY = new Set<string>();
/** 已上报过的地址：探测降级日志只记一次，避免每次重连刷屏。 */
const REPORTED = new Set<string>();

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const mediaType = (value: string | null): string => value?.split(';')[0]?.trim().toLowerCase() ?? '';

/** 地址归一键：忽略查询串、末尾斜杠与大小写差异，同一服务视为同一地址。 */
const urlKey = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
};

const hrefOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** 请求体是 JSON-RPC 请求时取出方法与 id，否则返回 undefined（不干预）。 */
const jsonRpcOf = (body: BodyInit | null | undefined): { readonly method?: string; readonly id?: unknown } | undefined => {
  if (typeof body !== 'string' || body.length > MAX_INSPECT_BYTES) return undefined;
  try {
    const parsed = record(JSON.parse(body));
    if (!parsed) return undefined;
    return { method: typeof parsed.method === 'string' ? parsed.method : undefined, id: parsed.id };
  } catch {
    return undefined;
  }
};

/** 响应体带空游标时返回「删掉该字段」的响应副本；其它情况返回 undefined，由调用方原样返回响应。 */
const withoutEmptyCursor = async (response: Response): Promise<Response | undefined> => {
  if (!response.ok || mediaType(response.headers.get('content-type')) !== 'application/json') return undefined;
  try {
    const parsed = record(await response.clone().json());
    const result = record(parsed?.result);
    if (!parsed || !result || (result.nextCursor !== '' && result.nextCursor !== null)) return undefined;
    const rest: Record<string, unknown> = { ...result };
    delete rest.nextCursor;
    const headers = new Headers(response.headers);
    // 正文被重写过，原长度与压缩信息不再适用，交给 fetch 实现重新计算。
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify({ ...parsed, result: rest }), { status: response.status, statusText: response.statusText, headers });
  } catch {
    return undefined;
  }
};

/**
 * 把某地址标记为「只服务握手时代」，让后续 discover 探测退回握手。返回 true 表示首次标记。
 * 由建连流程在捕获到时代不匹配错误后调用。
 */
export function forceLegacyProtocol(url: string): boolean {
  const key = urlKey(url);
  if (!key || LEGACY_ONLY.has(key)) return false;
  LEGACY_ONLY.add(key);
  return true;
}

/** 该地址是否已被判定为握手时代（供诊断与测试使用）。 */
export function isLegacyProtocolForced(url: string): boolean {
  const key = urlKey(url);
  return key !== undefined && LEGACY_ONLY.has(key);
}

/**
 * 错误链（含 `cause`）里是否带「协议时代不匹配」特征。
 * 官方客户端会把远端 errormessage 原样带进 message，包装层再套一层 `initial connection or tool synchronization failed`。
 */
export function isProtocolEraMismatch(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const text = current instanceof Error ? current.message : typeof current === 'string' ? current : '';
    if (ERA_MISMATCH_PATTERN.test(text)) return true;
    // 个别包装把远端 error.data 塞进属性而不是 message。
    const data = record(current)?.data;
    if (typeof data === 'string' && ERA_MISMATCH_PATTERN.test(data)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** 本地合成的 discover 应答：等价于「服务端不认识这个探测方法」，SDK 据此回退握手时代。 */
const methodNotFound = (id: unknown): Response => new Response(
  JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'Method not found', data: DISCOVER_METHOD } }),
  { status: 400, headers: { 'content-type': 'application/json' } },
);

export interface McpCompatHooks {
  /** 某个方法 + 地址第一次被改写（空游标）时回调一次，供宿主记日志。 */
  readonly onEmptyCursor?: (detail: { readonly method: string; readonly url: string }) => void;
  /** 某地址第一次被降级为握手时代时回调一次。 */
  readonly onLegacyProtocol?: (detail: { readonly url: string }) => void;
}

/**
 * 安装兼容层并返回卸载函数。
 * 已经安装过时返回空卸载函数：包装归第一个安装方所有，避免重复包装互相覆盖。
 */
export function installMcpCompat(hooks: McpCompatHooks = {}): () => void {
  const scope = globalThis as CompatScope;
  if (scope[INSTALLED]) return () => undefined;
  const original = globalThis.fetch;
  const patched: typeof fetch = async (input, init) => {
    const request = jsonRpcOf(init?.body);
    // 先处理协议时代：命中时不必发网络请求，直接用「方法不存在」逼 SDK 回退握手。
    if (request?.method === DISCOVER_METHOD) {
      const url = hrefOf(input);
      const key = urlKey(url);
      if (key && LEGACY_ONLY.has(key)) {
        if (hooks.onLegacyProtocol && !REPORTED.has(key)) { REPORTED.add(key); hooks.onLegacyProtocol({ url }); }
        return methodNotFound(request.id);
      }
    }
    const response = await original(input, init);
    if (!request?.method || !LIST_METHODS.includes(request.method)) return response;
    const rewritten = await withoutEmptyCursor(response);
    if (!rewritten) return response;
    const url = hrefOf(input);
    const key = `${request.method} ${url}`;
    if (hooks.onEmptyCursor && !REPORTED.has(key)) { REPORTED.add(key); hooks.onEmptyCursor({ method: request.method, url }); }
    return rewritten;
  };
  scope.fetch = patched;
  const uninstall = () => {
    if (scope.fetch === patched) scope.fetch = original;
    delete scope[INSTALLED];
    LEGACY_ONLY.clear();
    REPORTED.clear();
  };
  scope[INSTALLED] = uninstall;
  return uninstall;
}
