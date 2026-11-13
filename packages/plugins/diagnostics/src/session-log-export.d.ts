/**
 * 官方 `@deepseek-ai/dsh-session-log-export` 的最小类型声明。
 *
 * 该包由 Profile 运行时提供（官方 web-app bundle 的依赖），不作为本包的 npm 依赖安装：
 * 内网镜像的元数据可能取不到精确预发布版本。运行时按同一 node_modules 解析，
 * 导出面由 `tests/official-surface.test.mjs` 在 DSH 升级时守卫。
 */
declare module '@deepseek-ai/dsh-session-log-export' {
  export interface SessionLogExportDeps {
    sessionQuery?: unknown
    sessionPersistence?: unknown
    attachments?: unknown
    sessions?: unknown
  }

  export interface SessionLogEntry {
    path: string
    content?: string
    data?: Uint8Array
    chunks?: AsyncIterable<Uint8Array>
  }

  export const SESSION_LOG_EXPORT_PATH: string
  export const SESSION_LOG_FILENAME: string

  export function sessionLogExportDeps(ctx: unknown): SessionLogExportDeps
  export function readSessionLogText(
    persistence: unknown,
    id: string,
    signal?: AbortSignal,
  ): Promise<string | undefined>
  export function sessionLogZipEntries(
    deps: SessionLogExportDeps,
    rootContent: string,
    sessionId: string,
    includeDescendants: boolean,
    signal?: AbortSignal,
  ): AsyncGenerator<SessionLogEntry>
  export function sessionLogZipFilename(sessionId: string): string
}
