import { existsSync, createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { release as osRelease } from 'node:os'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { planDiagnostics } from './collect.js'
import { redactLogFile } from './redact.js'
import { zipStream, type ZipEntry } from './zip.js'

/** 产品诊断导出：官方 Session 日志 + 最近 24 小时的 WorkDSH 运行时日志。 */
export const name = 'workdsh-plugin-diagnostics'
export const inject = ['connection']

const EXPORT_PATH = '/api/workdsh.diagnostics.export'
const OFFICIAL_PACKAGE = '@deepseek-ai/dsh-session-log-export'
/** 导出前逐行脱敏的日志：旧版本可能已把明文凭据写进这些文件。会话条目不做任何处理。 */
const SANITIZED_LOG = /^(?:host-output|host-http|update|process-cleanup)-\d{4}-\d{2}-\d{2}\.log$/u
const sanitizes = (name: string): boolean => SANITIZED_LOG.test(name)

/** Host 侧只需要 connection 的注册面；其余服务按需 ctx.get，缺失时降级。 */
interface HostContext {
  connection: { fetch: { register(route: Record<string, unknown>): () => void } }
  effect(callback: () => () => void, label?: string): void
  get(service: string): unknown
}

interface SessionState {
  included: boolean
  reason: string | null
  packageVersion: string | null
}

const safeSegment = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_')

/** 读取官方导出包的版本号；读不到就用 null，不影响导出。 */
function officialVersion(): string | null {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require(`${OFFICIAL_PACKAGE}/package.json`) as { version?: string }
    return manifest.version ?? null
  } catch {
    return null
  }
}

/** 分块读取一个本机文件，交给 ZIP 流式写入。 */
async function* streamFile(path: string): AsyncGenerator<Uint8Array> {
  for await (const chunk of createReadStream(path)) yield chunk as Uint8Array
}

const binary = (body: string, status: number): Response => new Response(body, { status })

export function apply(context: Context): void {
  const ctx = context as unknown as HostContext
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: EXPORT_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request: Request) => handle(ctx, request),
      }),
    'workdsh.diagnostics.export',
  )
}

async function handle(ctx: HostContext, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')?.trim()
  if (!sessionId) return binary('missing sessionId query parameter', 400)

  const logDirectory = process.env.WORKDSH_LOG_DIR?.trim()
  const home = process.env.DSH_HOME?.trim()
  const plan = planDiagnostics({
    logDirectory,
    profileDirectory: home ? join(home, 'profiles', 'workdsh') : undefined,
  })

  const session: SessionState = { included: false, reason: null, packageVersion: officialVersion() }
  let official: typeof import('@deepseek-ai/dsh-session-log-export') | null = null
  let deps: ReturnType<typeof import('@deepseek-ai/dsh-session-log-export').sessionLogExportDeps> | null = null
  let rootContent: string | undefined
  try {
    const loaded = (await import(OFFICIAL_PACKAGE)) as typeof import('@deepseek-ai/dsh-session-log-export')
    const resolved = loaded.sessionLogExportDeps(ctx as unknown as Context)
    if (resolved.sessionQuery === undefined || resolved.sessionPersistence === undefined || resolved.attachments === undefined) {
      throw new Error('missing session-query, session-persistence, or attachments service')
    }
    const content = await loaded.readSessionLogText(resolved.sessionPersistence, sessionId)
    if (content === undefined) throw new Error(`session "${sessionId}" has no stored log`)
    official = loaded
    deps = resolved
    rootContent = content
    session.included = true
  } catch (error) {
    session.included = false
    session.reason = error instanceof Error ? error.message : String(error)
    rootContent = undefined
  }

  const filename = `workdsh-diagnostics-${safeSegment(process.env.WORKDSH_APP_VERSION ?? 'dev')}-${safeSegment(sessionId)}.zip`
  const headers = {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })

  const manifest = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    app: {
      version: process.env.WORKDSH_APP_VERSION ?? null,
      appId: process.env.WORKDSH_APP_ID ?? null,
      environment: process.env.WORKDSH_ENVIRONMENT ?? null,
    },
    os: { platform: process.platform, release: osRelease(), arch: process.arch, node: process.version },
    sessionId,
    sessionLog: { included: session.included, package: OFFICIAL_PACKAGE, packageVersion: session.packageVersion, reason: session.reason },
    files: plan.files.map((file) => ({ path: file.archivePath, bytes: file.bytes, redacted: sanitizes(basename(file.source)) })),
    totalBytes: plan.totalBytes,
  }

  const controller = new AbortController()
  request.signal.addEventListener('abort', () => controller.abort(), { once: true })

  const exporter = official
  const exportDeps = deps
  const sessionContent = rootContent
  const entries = (async function* (): AsyncGenerator<ZipEntry> {
    yield { path: 'manifest.json', content: JSON.stringify(manifest, null, 2) }
    if (session.included && exporter !== null && exportDeps !== null && sessionContent !== undefined) {
      for await (const entry of exporter.sessionLogZipEntries(exportDeps, sessionContent, sessionId, true, controller.signal)) {
        yield entry as unknown as ZipEntry
      }
    }
    for (const file of plan.files) {
      if (!existsSync(file.source)) continue
      yield {
        path: file.archivePath,
        chunks: sanitizes(basename(file.source)) ? redactLogFile(file.source, controller.signal) : streamFile(file.source),
      }
    }
  })()

  return new Response(zipStream(entries, { signal: controller.signal }), { status: 200, headers })
}
