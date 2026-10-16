/**
 * 空游标兼容层：私有部署的服务端 → 官方 MCP 客户端。
 *
 * 背景：MCP 规范里 `nextCursor` 只要**出现**就表示「还有下一页」。部分服务端在没有下一页时仍下发
 * `nextCursor: ""`（个别是 `null`），官方客户端会因此按游标再取一页，把同一批工具重复追加进聚合结果；
 * 官方 MCP 客户端插件随后按工具名判重并抛 `server listed tool "..." more than once — invalid tool list`，
 * 整条连接被判定失败（界面提示 `initial connection or tool synchronization failed`）。
 *
 * 服务端短期无法修改，因此在客户端做一层最小兼容：只对 JSON-RPC 的列表方法、且响应体确实带空游标时，
 * 复制响应并删掉该字段；其余请求原样透传（不复制、不缓冲、不影响流式响应），空游标以外的问题一律不处理。
 * 服务端按规范省略 / 非空游标后，本层不会被触发，可随时删除。
 */
/** 官方客户端会对这些列表方法的 `nextCursor` 翻页。 */
const LIST_METHODS: readonly string[] = ['tools/list', 'resources/list', 'resources/templates/list', 'prompts/list'];
/** 只检查小请求体：MCP 列表请求都很短，避免为模型调用等大 POST 体做多余的 JSON 解析。 */
const MAX_INSPECT_BYTES = 8 * 1024;
/** 进程级安装标记：重复安装时沿用已有包装，不叠加。 */
const INSTALLED = Symbol.for('workdsh.connectors.emptyCursorCompat');

type CompatScope = typeof globalThis & { [INSTALLED]?: () => void };

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const mediaType = (value: string | null): string => value?.split(';')[0]?.trim().toLowerCase() ?? '';

/** 请求体是列表方法的 JSON-RPC 请求时返回方法名，否则返回 undefined（不干预）。 */
const listMethodOf = (body: BodyInit | null | undefined): string | undefined => {
  if (typeof body !== 'string' || body.length > MAX_INSPECT_BYTES) return undefined;
  try {
    const method = (JSON.parse(body) as { method?: unknown }).method;
    return typeof method === 'string' && LIST_METHODS.includes(method) ? method : undefined;
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
 * 安装兼容层并返回卸载函数；`onRewrite` 在某个方法 + 地址第一次被改写时回调一次（供宿主记日志）。
 * 已经安装过时返回空卸载函数：包装归第一个安装方所有，避免重复包装互相覆盖。
 */
export function installEmptyCursorCompat(onRewrite?: (detail: { readonly method: string; readonly url: string }) => void): () => void {
  const scope = globalThis as CompatScope;
  if (scope[INSTALLED]) return () => undefined;
  const original = globalThis.fetch;
  const reported = new Set<string>();
  const patched: typeof fetch = async (input, init) => {
    const method = listMethodOf(init?.body);
    const response = await original(input, init);
    if (!method) return response;
    const rewritten = await withoutEmptyCursor(response);
    if (!rewritten) return response;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${method} ${url}`;
    if (onRewrite && !reported.has(key)) { reported.add(key); onRewrite({ method, url }); }
    return rewritten;
  };
  scope.fetch = patched;
  const uninstall = () => {
    if (scope.fetch === patched) scope.fetch = original;
    delete scope[INSTALLED];
  };
  scope[INSTALLED] = uninstall;
  return uninstall;
}
