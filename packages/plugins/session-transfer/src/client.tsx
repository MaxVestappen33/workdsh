/**
 * 会话迁移插件 Client 侧。
 *
 * 入口：
 *  - `sidebar.panellist`：侧栏「会话迁移」（位于「资料库」下方），切换主面板
 *  - `main`：主区域整页渲染会话迁移（导出 / 导入）
 *  - `sidebar.workspaces.session.menu.item`：会话行右键「迁移会话」（预选该会话并打开主面板）
 *
 * 交互状态机：
 *  - 导出：选择会话 → 预览统计 → 生成下载
 *  - 导入：选择/拖放 ZIP → 预览（版本裁决/工作区映射/冲突/归档策略）→
 *          进度（轮询 status、可取消回滚）→ 结果报告
 *
 * 只依赖 React 与官方 primitives；所有类型从 ./types.js 以 `import type` 引入，
 * 不把任何 Node 内置模块带进浏览器 bundle。
 */

import type { Context } from '@deepseek-ai/cordis'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type ReactElement,
} from 'react'
import { ROUTES, UNASSIGNED_WORKSPACE_ID } from './constants.js'
import type {
  ApplyRequest, ArchivePolicy, Decision, ExportPreview, ExportRequest,
  ImportPreview, JobStatus, ResultRow, SessionItem, WorkspaceMapping,
} from './types.js'

export const name = 'workdsh-plugin-session-transfer-client'
export const inject = ['slots', 'layout', 'sessions']

/** 主面板 id，同时作为侧栏入口 id。 */
const PANEL_ID = 'workdsh-session-transfer'

// ---------------------------------------------------------------------------
// 运行时插槽的最小接口（避免对官方 SlotMap 声明合并产生编译期耦合）
// ---------------------------------------------------------------------------

interface SlotsLike {
  inject(name: string, factory: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface LayoutLike {
  selectPanel(id: string): void
}

/** 官方会话列表客户端服务；导入完成后用它刷新侧栏列表与投影。 */
interface SessionsClientLike {
  refresh(): Promise<void>
  refreshProjections?(sessionId: string): Promise<void>
}

let clientSessions: SessionsClientLike | undefined

async function refreshOfficialSessions(sessionIds: readonly string[]): Promise<void> {
  const sessions = clientSessions
  if (sessions === undefined) return
  await Promise.allSettled(sessionIds.map((id) => sessions.refreshProjections?.(id) ?? Promise.resolve()))
  await sessions.refresh().catch(() => undefined)
}

interface MenuEntryProps {
  sessionId: string
  displayTitle: string
  useMenuOpenState: () => readonly [boolean, (open: boolean) => void]
}

/** 会话行右键菜单预选的会话 id；主面板订阅它。 */
interface PresetStore {
  get(): string | null
  set(value: string | null): void
  subscribe(listener: () => void): () => void
}

function createPresetStore(): PresetStore {
  let value: string | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

export function apply(ctx: Context): void {
  const preset = createPresetStore()
  const slots = (ctx as unknown as { slots: SlotsLike }).slots
  const layout = (ctx as unknown as { layout?: LayoutLike }).layout
  clientSessions = (ctx as unknown as { sessions?: SessionsClientLike }).sessions
  const openPanel = (sessionId?: string): void => {
    preset.set(sessionId ?? null)
    layout?.selectPanel(PANEL_ID)
  }

  // 侧栏入口：位于「资料库」下方的全局面板行
  slots.inject('sidebar.panellist', () => slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, label: '会话迁移', order: 55 },
    (({ size }: { size: number }) => <TransferIcon size={size} />) as never,
  ))

  // 主面板：整页导出 / 导入
  slots.inject('main', () => slots.register(
    { name: 'main', key: PANEL_ID, inject: () => ({ preset }) },
    (({ preset: injected }: { preset?: PresetStore }) => <TransferPage preset={injected} />) as never,
  ))

  // 会话行右键：打开主面板并预选该会话
  slots.inject('sidebar.workspaces.session.menu.item', () => slots.register(
    { name: 'sidebar.workspaces.session.menu.item', id: PANEL_ID, order: 550 },
    (({ sessionId, useMenuOpenState }: MenuEntryProps) => {
      const [, setMenuOpen] = useMenuOpenState()
      return (
        <MenuItemButton
          icon={<TransferIcon size={16} />}
          onSelect={() => {
            setMenuOpen(false)
            openPanel(sessionId)
          }}
        >
          迁移会话
        </MenuItemButton>
      )
    }) as never,
  ))

  // 宿主启动后会回填历史导入会话的标题投影；稍后刷新侧栏，让名称无需点击即可出现
  const refreshTimers = [6000, 20000].map((delay) => setTimeout(
    () => { void clientSessions?.refresh().catch(() => undefined) },
    delay,
  ))
  for (const timer of refreshTimers) (timer as unknown as { unref?: () => void }).unref?.()
  ;(ctx as unknown as { effect?: (callback: () => () => void) => void }).effect?.(() => () => {
    for (const timer of refreshTimers) clearTimeout(timer)
  })
}

// ---------------------------------------------------------------------------
// 通用 UI 原子
// ---------------------------------------------------------------------------

function TransferIcon({ size = 18 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h11" /><path d="m12 4 3 3-3 3" />
      <path d="M20 17H9" /><path d="m12 14-3 3 3 3" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// 主面板：整页导出 / 导入
// ---------------------------------------------------------------------------

function TransferPage({ preset }: { preset?: PresetStore }): ReactElement {
  const [tab, setTab] = useState<'export' | 'import'>('export')
  const [presetSessionId, setPresetSessionId] = useState<string | null>(() => preset?.get() ?? null)
  useEffect(() => preset?.subscribe(() => setPresetSessionId(preset.get())), [preset])
  // 会话行右键预选时总是回到导出 Tab
  useEffect(() => { if (presetSessionId !== null) setTab('export') }, [presetSessionId])

  return (
    <section style={S.page}>
      <div style={S.pageHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TransferIcon size={20} />
          <span style={{ fontSize: 17, fontWeight: 600 }}>会话迁移</span>
        </div>
        <div style={S.tabs}>
          <button type="button" onClick={() => setTab('export')}
            style={{ ...S.tab, ...(tab === 'export' ? S.tabActive : {}) }}>导出</button>
          <button type="button" onClick={() => setTab('import')}
            style={{ ...S.tab, ...(tab === 'import' ? S.tabActive : {}) }}>导入</button>
        </div>
      </div>
      <div style={S.pageBody}>
        <div style={{ display: tab === 'export' ? 'block' : 'none' }}>
          <ExportPanel active={tab === 'export'} presetSessionId={presetSessionId} />
        </div>
        <div style={{ display: tab === 'import' ? 'block' : 'none' }}>
          <ImportPanel />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  let payload: unknown
  try { payload = await response.json() } catch { payload = undefined }
  if (!response.ok) {
    const err = (payload as { error?: { message?: unknown; code?: unknown } } | undefined)?.error
    const message = typeof err?.message === 'string' && err.message.length > 0
      ? err.message
      : `请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  return payload as T
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

function formatDate(iso: string): string {
  if (iso === '') return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function phaseLabel(phase: JobStatus['phase'] | undefined): string {
  switch (phase) {
    case 'validate': return '校验中'
    case 'logs': return '写入会话'
    case 'attachments': return '还原附件'
    case 'workspace-files': return '还原源文件'
    case 'archive': return '整理归档'
    case 'bind': return '绑定归属'
    case 'done': return '已完成'
    default: return '准备中'
  }
}

// ---------------------------------------------------------------------------
// 共用小组件
// ---------------------------------------------------------------------------

function Steps({ labels, current }: { labels: readonly string[]; current: number }): ReactElement {
  return (
    <div style={S.steps}>
      {labels.map((label, index) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span style={{ ...S.stepDot, ...(index <= current ? S.stepDotActive : {}) }}>{index + 1}</span>
          <span style={{ fontSize: 12, color: index <= current ? 'var(--dsw-alias-label-primary, #171717)' : 'var(--dsw-alias-label-tertiary, #9a9a9a)' }}>
            {label}
          </span>
          {index < labels.length - 1 ? <span style={S.stepLine} /> : null}
        </div>
      ))}
    </div>
  )
}

function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'warn' | 'danger' | 'ok' }): ReactElement {
  const colors: Record<string, string> = {
    neutral: 'var(--dsw-alias-label-secondary, #6b6b6b)',
    warn: '#b45309', danger: '#c62828', ok: '#2e7d32',
  }
  return <span style={{ ...S.badge, color: colors[tone] }}>{text}</span>
}

function ProgressBar({ percent, label }: { percent: number; label: string }): ReactElement {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
        <span>{label}</span><span>{percent}%</span>
      </div>
      <div style={S.track}><div style={{ ...S.fill, width: `${percent}%` }} /></div>
    </div>
  )
}

function ErrorBox({ text }: { text: string | null }): ReactElement | null {
  return text === null ? null : <div role="alert" style={S.errorBox}>{text}</div>
}

// ---------------------------------------------------------------------------
// 导出流程
// ---------------------------------------------------------------------------

type ExportStep = 'select' | 'preview' | 'download' | 'done'

interface ExportState {
  step: ExportStep
  loading: boolean
  error: string | null
  list: ExportPreview | null
  selected: Set<string>
  search: string
  /** 已收起的工作区分组；默认全部展开 */
  collapsed: Set<string>
  /** 勾选「携带工作区文件」的 workspace id */
  fileScope: Set<string>
  userExcludes: string
  preview: ExportPreview | null
  job: JobStatus | null
  jobId: string | null
  downloading: boolean
  filename: string | null
}

const INITIAL_EXPORT: ExportState = {
  step: 'select', loading: false, error: null, list: null, selected: new Set(),
  search: '', collapsed: new Set(), fileScope: new Set(), userExcludes: '', preview: null,
  job: null, jobId: null, downloading: false, filename: null,
}

const EXPORT_STEPS = ['选择会话', '预览内容', '生成并下载'] as const

function ExportPanel({ active, presetSessionId }: {
  active: boolean
  presetSessionId: string | null
}): ReactElement {
  const [state, setState] = useState<ExportState>(INITIAL_EXPORT)
  const loaded = useRef(false)
  const patch = useCallback((value: Partial<ExportState>) => {
    setState((previous) => ({ ...previous, ...value }))
  }, [])

  // 首次激活时拉取会话清单（空选 = 轻量列举，不触发 flush / 读日志）
  useEffect(() => {
    if (!active || loaded.current) return
    loaded.current = true
    patch({ loading: true })
    postJson<ExportPreview>(ROUTES.exportPreview, {})
      .then((list) => patch({ list, loading: false, error: null }))
      .catch((error) => patch({ loading: false, error: errorMessage(error) }))
  }, [active, patch])

  // 会话行右键预选：清单就绪后把该会话加入选择
  useEffect(() => {
    if (presetSessionId === null || state.list === null) return
    const hit = state.list.sessions.find((item) => item.id === presetSessionId && !item.running)
    if (hit === undefined) return
    patch({ selected: new Set([hit.id]), step: 'select' })
  }, [presetSessionId, state.list, patch])

  // 导出进度轮询（jobId 来自响应头）
  useEffect(() => {
    if (state.jobId === null) return
    let stopped = false
    let timer = 0
    const tick = async (): Promise<void> => {
      try {
        const status = await api<JobStatus>(`${ROUTES.exportStatus}?jobId=${encodeURIComponent(state.jobId ?? '')}`)
        if (stopped) return
        patch({ job: status })
        if (status.state === 'running') timer = window.setTimeout(() => void tick(), 400)
      } catch {
        if (!stopped) timer = window.setTimeout(() => void tick(), 800)
      }
    }
    void tick()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [state.jobId, patch])

  const requestBody = (): ExportRequest => ({
    sessionIds: [...state.selected],
    includeWorkspaceFiles: state.fileScope.size > 0,
    fileWorkspaceIds: [...state.fileScope],
    userExcludes: state.userExcludes.split(/[\n,]/u).map((rule) => rule.trim()).filter((rule) => rule !== ''),
    archivePolicy: 'preserve',
  })

  const toPreview = async (): Promise<void> => {
    patch({ loading: true, error: null })
    try {
      const preview = await postJson<ExportPreview>(ROUTES.exportPreview, requestBody())
      patch({ preview, step: 'preview', loading: false })
    } catch (error) {
      patch({ loading: false, error: errorMessage(error) })
    }
  }

  const runExport = async (): Promise<void> => {
    patch({ step: 'download', downloading: true, error: null, job: null, jobId: null })
    try {
      const response = await fetch(ROUTES.exportRun, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody()),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => undefined) as { error?: { message?: unknown } } | undefined
        const message = payload?.error?.message
        throw new Error(typeof message === 'string' ? message : `导出失败（HTTP ${response.status}）`)
      }
      const jobId = response.headers.get('x-transfer-job-id')
      const disposition = response.headers.get('content-disposition') ?? ''
      const match = /filename="([^"]+)"/u.exec(disposition)
      const filename = match?.[1] ?? `session-transfer-${Date.now()}.zip`
      patch({ jobId, filename })
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      patch({ step: 'done', downloading: false })
    } catch (error) {
      patch({ downloading: false, error: errorMessage(error) })
    }
  }

  const allSelectable = useMemo(
    () => (state.list?.sessions ?? []).filter((item) => !item.running),
    [state.list],
  )

  const toggle = (id: string): void => {
    const next = new Set(state.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    patch({ selected: next })
  }

  const toggleGroup = (group: { sessions: readonly SessionItem[] }): void => {
    const ids = group.sessions.filter((item) => !item.running).map((item) => item.id)
    if (ids.length === 0) return
    const next = new Set(state.selected)
    const allSelected = ids.every((id) => next.has(id))
    for (const id of ids) {
      if (allSelected) next.delete(id)
      else next.add(id)
    }
    patch({ selected: next })
  }

  const toggleCollapsed = (id: string): void => {
    const next = new Set(state.collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    patch({ collapsed: next })
  }

  const toggleFileScope = (id: string, checked: boolean): void => {
    const next = new Set(state.fileScope)
    if (checked) next.add(id)
    else next.delete(id)
    patch({ fileScope: next })
  }

  const filteredGroups = useMemo(() => {
    const query = state.search.trim().toLowerCase()
    return (state.list?.groups ?? []).map((group) => ({
      ...group,
      sessions: group.sessions.filter((item) =>
        query === '' || item.title.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)),
    })).filter((group) => group.sessions.length > 0)
  }, [state.list, state.search])

  return (
    <div>
      <Steps labels={EXPORT_STEPS} current={state.step === 'done' ? 2 : state.step === 'preview' || state.step === 'download' ? 1 : 0} />
      <ErrorBox text={state.error} />

      {state.step === 'select' ? (
        <>
          <div style={S.toolbar}>
            <input value={state.search} onChange={(event) => patch({ search: event.target.value })}
              placeholder="搜索会话名称或 ID" style={S.input} />
            <button type="button" style={S.ghostButton}
              onClick={() => patch({ selected: new Set(allSelectable.map((item) => item.id)) })}>全选</button>
            <button type="button" style={S.ghostButton}
              onClick={() => patch({ selected: new Set(), fileScope: new Set() })}>清空</button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #6b6b6b)' }}>
              已选 {state.selected.size} / {allSelectable.length}
            </span>
          </div>
          <div style={S.listBox}>
            {state.loading ? <div style={S.empty}>正在读取会话列表…</div> : null}
            {!state.loading && filteredGroups.length === 0 ? <div style={S.empty}>没有可导出的会话。</div> : null}
            {filteredGroups.map((group) => {
              const collapsed = state.collapsed.has(group.id)
              const selectable = group.sessions.filter((item) => !item.running)
              const allSelected = selectable.length > 0 && selectable.every((item) => state.selected.has(item.id))
              return (
                <div key={group.id}>
                  <div style={S.groupHeader}>
                    <button type="button" onClick={() => toggleCollapsed(group.id)}
                      aria-expanded={!collapsed} aria-label={collapsed ? '展开工作区' : '收起工作区'}
                      style={{ ...S.groupToggle, transform: collapsed ? 'rotate(-90deg)' : 'none' }}>▾</button>
                    <span style={S.groupTitle}>{group.title}</span>
                    <span style={S.groupPath}>{group.path}</span>
                    <label
                      style={{ ...S.groupFileToggle, ...(group.path === '' ? S.groupFileToggleDisabled : {}) }}
                      title={group.path === ''
                        ? '未归属工作区：这些会话没有登记的工作区目录，没有可携带的工作区文件。'
                        : '只带该工作区内被会话引用过、且位于工作区内的相对路径文件；不整目录打包。'}
                    >
                      <input type="checkbox" disabled={group.path === ''}
                        checked={group.path !== '' && state.fileScope.has(group.id)}
                        onChange={(event) => toggleFileScope(group.id, event.target.checked)} />
                      携带工作区文件
                    </label>
                    <button type="button" style={S.groupAction} disabled={selectable.length === 0}
                      onClick={() => toggleGroup(group)}>{allSelected ? '取消全选' : '全选'}</button>
                  </div>
                  {collapsed ? null : group.sessions.map((item) => (
                    <SessionRow key={item.id} item={item} checked={state.selected.has(item.id)}
                      disabled={item.running} onToggle={() => toggle(item.id)} mode="export" />
                  ))}
                </div>
              )
            })}
          </div>
          {state.fileScope.size > 0 ? (
            <div style={S.optionsBox}>
              <div style={S.hint}>附加忽略规则（每行一条，内置安全基线不可移除）</div>
              <textarea value={state.userExcludes}
                onChange={(event) => patch({ userExcludes: event.target.value })}
                placeholder={'*.log\nbuild/\nsecrets.json'} style={S.textarea} rows={3} />
            </div>
          ) : null}
          <div style={S.footerRow}>
            <span style={S.hint}>运行中会话不可导出；已打开会话会在导出前自动保存。勾选工作区行内的「携带工作区文件」可把该工作区被引用的文件一并打包。</span>
            <button type="button" style={S.primaryButton} disabled={state.loading || state.selected.size === 0}
              onClick={() => void toPreview()}>下一步：预览</button>
          </div>
        </>
      ) : null}

      {state.step === 'preview' && state.preview !== null ? (
        <>
          <div style={S.statGrid}>
            <Stat label="会话" value={`${state.preview.totals.sessionCount} 个`} />
            <Stat label="附件" value={`${state.preview.attachments.count} 个 · ${formatBytes(state.preview.attachments.bytes)}`} />
            <Stat label="工作区文件" value={state.fileScope.size > 0
              ? `${state.preview.workspaceFiles.fileCount} 个 · ${formatBytes(state.preview.workspaceFiles.byteLength)}`
              : '未携带'} />
            <Stat label="跳过/排除" value={`${state.preview.workspaceFiles.skipped} 项`} />
            <Stat label="预计包大小" value={formatBytes(state.preview.totals.byteLength)} />
            <Stat label="归档会话" value={`${state.preview.sessions.filter((item) => item.archived).length} 个`} />
          </div>
          {state.preview.exceeds.length > 0 ? (
            <div style={S.warnBox}>{state.preview.exceeds.join('；')}</div>
          ) : null}
          <div style={{ ...S.hint, marginTop: 12 }}>
            包内为明文会话日志（可被新版客户端自动升级）、附件与被引用的工作区文件；不覆盖目标设备已有会话。
          </div>
          <div style={S.footerRow}>
            <button type="button" style={S.ghostButton} onClick={() => patch({ step: 'select' })}>上一步</button>
            <button type="button" style={S.primaryButton} disabled={state.loading}
              onClick={() => void runExport()}>生成并下载</button>
          </div>
        </>
      ) : null}

      {state.step === 'download' || state.step === 'done' ? (
        <>
          <div style={S.centerBox}>
            {state.step === 'done' ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>导出完成</div>
                <div style={S.hint}>文件已保存到下载目录：{state.filename ?? '会话迁移包'}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>正在生成会话迁移包…</div>
                <div style={S.hint}>生成完成后会自动触发下载。</div>
                <ProgressBar percent={state.job?.percent ?? 0} label={state.job?.current ?? phaseLabel(state.job?.phase)} />
              </>
            )}
          </div>
          <div style={S.footerRow}>
            <span style={S.hint}>{state.job === null ? '' : phaseLabel(state.job.phase)}</span>
            <button type="button" style={state.step === 'done' ? S.primaryButton : S.ghostButton}
              disabled={state.downloading}
              onClick={() => patch({ step: 'select', job: null, jobId: null })}>返回列表</button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={S.statCard}>
      <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #6b6b6b)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

function SessionRow({ item, checked, disabled, onToggle, mode, conflict }: {
  item: SessionItem
  checked: boolean
  disabled?: boolean
  onToggle: () => void
  mode: 'export' | 'import'
  conflict?: boolean
}): ReactElement {
  return (
    <label style={{ ...S.sessionRow, ...(disabled === true ? S.sessionRowDisabled : {}) }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title}
        </span>
        <span style={S.sessionMeta}>
          {formatDate(item.at)} · {formatBytes(item.sizeBytes)}
          {item.subs > 0 ? ` · ${item.subs} 个子会话` : ''}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {item.archived ? <Badge text="已归档" /> : null}
        {mode === 'export' && item.running ? <Badge text="运行中" tone="danger" /> : null}
        {mode === 'export' && item.opened && !item.running ? <Badge text="已打开" tone="warn" /> : null}
        {mode === 'import' && conflict === true ? <Badge text="本地已有同 ID" tone="warn" /> : null}
      </span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// 导入流程
// ---------------------------------------------------------------------------

type ImportStep = 'pick' | 'preview' | 'progress' | 'result'

interface ImportState {
  step: ImportStep
  loading: boolean
  error: string | null
  file: File | null
  dragOver: boolean
  preview: ImportPreview | null
  decisions: Record<string, boolean>
  mapping: WorkspaceMapping[]
  archivePolicy: ArchivePolicy
  batchId: string | null
  job: JobStatus | null
  cancelling: boolean
}

const INITIAL_IMPORT: ImportState = {
  step: 'pick', loading: false, error: null, file: null, dragOver: false,
  preview: null, decisions: {}, mapping: [], archivePolicy: 'preserve',
  batchId: null, job: null, cancelling: false,
}

const IMPORT_STEPS = ['选择迁移包', '预览与设置', '导入中', '结果报告'] as const

function ImportPanel(): ReactElement {
  const [state, setState] = useState<ImportState>(INITIAL_IMPORT)
  const fileInput = useRef<HTMLInputElement>(null)
  const refreshed = useRef(false)
  const patch = useCallback((value: Partial<ImportState>) => {
    setState((previous) => ({ ...previous, ...value }))
  }, [])

  // 进度轮询
  useEffect(() => {
    if (state.batchId === null) return
    let stopped = false
    let timer = 0
    const tick = async (): Promise<void> => {
      try {
        const status = await api<JobStatus>(`${ROUTES.importStatus}?batchId=${encodeURIComponent(state.batchId ?? '')}`)
        if (stopped) return
        patch({ job: status })
        if (status.state === 'running') {
          timer = window.setTimeout(() => void tick(), 400)
        } else {
          patch({ step: 'result', cancelling: false })
          // 导入是宿主侧直接落盘，官方客户端列表不会自动感知：结束后主动刷新一次，
          // 否则侧栏要重启才看得到新会话。
          if (!refreshed.current) {
            refreshed.current = true
            const imported = (status.result ?? [])
              .filter((row) => row.status === 'imported')
              .map((row) => row.sessionId)
            if (imported.length > 0) void refreshOfficialSessions(imported)
          }
        }
      } catch {
        if (!stopped) timer = window.setTimeout(() => void tick(), 800)
      }
    }
    void tick()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [state.batchId, patch])

  const parseFile = async (file: File): Promise<void> => {
    patch({ loading: true, error: null, file })
    try {
      const preview = await api<ImportPreview>(ROUTES.importPreview, {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: file,
      })
      const decisions: Record<string, boolean> = {}
      for (const session of preview.sessions) decisions[session.id] = true
      patch({
        preview, decisions, mapping: preview.workspaces.map((item) => ({ ...item })),
        archivePolicy: preview.archiveDefault, step: 'preview', loading: false,
      })
    } catch (error) {
      patch({ loading: false, error: errorMessage(error) })
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    patch({ dragOver: false })
    const file = event.dataTransfer.files[0]
    if (file !== undefined) void parseFile(file)
  }

  /** 会话在「目标工作区」里对应的映射行 id；apply 按行 id 解析真实目标（含新建）。 */
  const mappingTargetOf = (mapping: readonly WorkspaceMapping[], workspaceId: string): string => {
    const key = workspaceId === '' ? UNASSIGNED_WORKSPACE_ID : workspaceId
    return mapping.some((item) => item.id === key) ? key : ''
  }

  const applyImport = async (): Promise<void> => {
    if (state.preview === null) return
    const decisions: Decision[] = state.preview.sessions.map((session) => ({
      sessionId: session.id,
      importAsNew: state.decisions[session.id] === true,
      // 目标工作区来自用户在「目标工作区」里的选择；未归属会话共用虚拟映射行
      targetWorkspaceId: mappingTargetOf(state.mapping, session.workspaceId),
    }))
    const body: ApplyRequest = {
      token: state.preview.token,
      decisions,
      mapping: state.mapping,
      archivePolicy: state.archivePolicy,
    }
    patch({ loading: true, error: null })
    try {
      refreshed.current = false
      const result = await postJson<{ batchId: string }>(ROUTES.importApply, body)
      patch({ batchId: result.batchId, step: 'progress', loading: false, job: null })
    } catch (error) {
      patch({ loading: false, error: errorMessage(error) })
    }
  }

  const cancelImport = async (): Promise<void> => {
    if (state.batchId === null) return
    patch({ cancelling: true })
    try {
      await postJson(ROUTES.importCancel, { batchId: state.batchId })
    } catch (error) {
      patch({ cancelling: false, error: errorMessage(error) })
    }
  }

  const updateMapping = (id: string, value: Partial<WorkspaceMapping>): void => {
    patch({ mapping: state.mapping.map((item) => item.id === id ? { ...item, ...value } : item) })
  }

  const selectedCount = state.preview === null ? 0
    : state.preview.sessions.filter((session) => state.decisions[session.id] === true).length
  const mappingInvalid = state.mapping.some((item) =>
    item.targetId === '' || (item.targetId === '__new__' && item.targetPath.trim() === '') || item.status === 'invalid')
  const rejected = state.preview?.rejection !== undefined

  return (
    <div>
      <Steps labels={IMPORT_STEPS} current={
        state.step === 'pick' ? 0
          : state.step === 'preview' ? 1
            : state.step === 'result' ? 3
              : 2
      } />
      <ErrorBox text={state.error} />

      {state.step === 'pick' ? (
        <>
          <div
            onDragOver={(event) => { event.preventDefault(); patch({ dragOver: true }) }}
            onDragLeave={() => patch({ dragOver: false })}
            onDrop={onDrop}
            style={{ ...S.dropZone, ...(state.dragOver ? S.dropZoneActive : {}) }}
          >
            <TransferIcon size={30} />
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 10 }}>把会话迁移包拖到这里</div>
            <div style={S.hint}>仅支持本功能导出的 .zip 包；拖放区只在本页面内生效。</div>
            <button type="button" style={{ ...S.primaryButton, marginTop: 14 }}
              onClick={() => fileInput.current?.click()} disabled={state.loading}>
              {state.loading ? '正在解析…' : '选择 .zip 文件'}
            </button>
            <input ref={fileInput} type="file" accept=".zip,application/zip" style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) void parseFile(file)
                event.target.value = ''
              }} />
          </div>
          {state.file === null ? null : (
            <div style={S.fileChip}>{state.file.name} · {formatBytes(state.file.size)}</div>
          )}
          <div style={{ ...S.hint, marginTop: 14 }}>
            导入不会覆盖本机已有会话：同 ID 的会话会作为新会话导入，并在标题后加「（导入）」。
          </div>
        </>
      ) : null}

      {state.step === 'preview' && state.preview !== null ? (
        <>
          {rejected ? (
            <div style={S.errorBox}>
              <strong>无法导入此包</strong>
              <div style={{ marginTop: 4 }}>{state.preview.rejection?.message}</div>
            </div>
          ) : null}
          <SummaryGrid preview={state.preview} />
          {state.preview.targetDirStatus === 'invalid' ? (
            <div style={S.warnBox}>有目标目录已存在内容，请在下方「目标工作区」里更换为空目录或新建目录。</div>
          ) : null}

          <div style={S.sectionTitle}>目标工作区</div>
          <div style={S.listBox}>
            {state.mapping.map((item) => (
              <MappingRow key={item.id} item={item}
                options={state.preview?.localWorkspaces ?? []}
                onChange={(value) => updateMapping(item.id, value)} />
            ))}
            {state.mapping.length === 0 ? <div style={S.empty}>包内没有工作区信息。</div> : null}
          </div>

          <div style={S.sectionTitle}>选择要导入的会话</div>
          <div style={{ ...S.listBox, maxHeight: 210 }}>
            {state.preview.sessions.map((session) => (
              <SessionRow key={session.id} item={session} mode="import"
                conflict={state.preview?.conflicts.includes(session.id) === true}
                checked={state.decisions[session.id] === true}
                onToggle={() => patch({ decisions: { ...state.decisions, [session.id]: state.decisions[session.id] !== true } })} />
            ))}
          </div>

          <div style={S.sectionTitle}>归档状态</div>
          <div style={S.radioGroup}>
            <label style={S.radioRow}>
              <input type="radio" checked={state.archivePolicy === 'preserve'}
                onChange={() => patch({ archivePolicy: 'preserve' })} />
              <span>按包内状态恢复（{state.preview.summary.archivedCount} 个已归档）</span>
            </label>
            <label style={S.radioRow}>
              <input type="radio" checked={state.archivePolicy === 'none'}
                onChange={() => patch({ archivePolicy: 'none' })} />
              <span>全部设为未归档</span>
            </label>
          </div>

          <div style={S.footerRow}>
            <button type="button" style={S.ghostButton}
              onClick={() => patch({ step: 'pick', preview: null, batchId: null, job: null })}>上一步</button>
            <span style={S.hint}>已选 {selectedCount} 个会话</span>
            <button type="button" style={S.primaryButton}
              disabled={rejected || state.loading || selectedCount === 0 || mappingInvalid}
              onClick={() => void applyImport()}>开始导入</button>
          </div>
        </>
      ) : null}

      {state.step === 'progress' ? (
        <>
          <div style={S.centerBox}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
              {state.job?.state === 'cancelled' ? '正在回滚本次导入…' : '正在导入会话…'}
            </div>
            <div style={S.hint}>{state.job?.current ?? '准备中'}</div>
            <ProgressBar percent={state.job?.percent ?? 0} label={phaseLabel(state.job?.phase)} />
          </div>
          <div style={S.footerRow}>
            <span style={S.hint}>取消会回滚本次导入的全部会话、文件与绑定。</span>
            <button type="button" style={S.dangerButton}
              disabled={state.cancelling || state.job?.cancellable === false}
              onClick={() => void cancelImport()}>{state.cancelling ? '正在取消…' : '取消导入'}</button>
          </div>
        </>
      ) : null}

      {state.step === 'result' ? (
        <ResultView job={state.job} onClose={() => patch({ ...INITIAL_IMPORT })} />
      ) : null}
    </div>
  )
}

function SummaryGrid({ preview }: { preview: ImportPreview }): ReactElement {
  const summary = preview.summary
  const verdict = preview.versionVerdict
  return (
    <>
      <div style={S.statGrid}>
        <Stat label="来源设备" value={summary.device} />
        <Stat label="导出时间" value={formatDate(summary.exportedAt)} />
        <Stat label="客户端版本" value={summary.appVersion} />
        <Stat label="DSH 版本" value={summary.dshVersion} />
        <Stat label="事件格式" value={`v${summary.sourceVersion} → 本机 v${summary.localVersion}`} />
        <Stat label="会话 / 工作区" value={`${summary.sessionCount} / ${summary.workspaceCount}`} />
        <Stat label="附件" value={`${summary.attachmentCount} 个`} />
        <Stat label="缺失附件" value={`${summary.missingAttachments} 个`} />
        <Stat label="工作区文件" value={summary.filesIncluded
          ? `${summary.fileCount} 个 · ${formatBytes(summary.fileBytes)}` : '未携带'} />
        <Stat label="排除/跳过" value={`${summary.excludedCount} 项`} />
        <Stat label="已归档会话" value={`${summary.archivedCount} 个`} />
        <Stat label="置顶/排序" value="不迁移" />
      </div>
      <div style={verdict === 'unsupported' || verdict === 'malformed' || verdict === 'corrupt' ? S.errorBox : S.infoBox}>
        {verdict === 'migration-required'
          ? `此包为 v${summary.sourceVersion}，导入时将复用官方迁移链自动升级到 v${summary.localVersion}。`
          : verdict === 'current'
            ? '事件格式版本与本机一致，可直接导入。'
            : '此包来自更新版本的客户端，请升级当前客户端后重试。'}
      </div>
    </>
  )
}

function MappingRow({ item, options, onChange }: {
  item: WorkspaceMapping
  options: readonly { id: string; title: string; path: string }[]
  onChange: (value: Partial<WorkspaceMapping>) => void
}): ReactElement {
  return (
    <div style={S.mappingRow}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.title}</div>
      <div style={S.hint}>
        {item.sourcePath === '' ? '来源：包内未归属任何工作区的会话' : `来源：${item.sourcePath}`}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <select value={item.targetId} style={S.select}
          onChange={(event) => {
            const targetId = event.target.value
            const option = options.find((entry) => entry.id === targetId)
            onChange(targetId === '__new__'
              ? { targetId, targetPath: item.targetPath || item.sourcePath, status: 'fallback' }
              : { targetId, targetPath: option?.path ?? '', status: 'matched' })
          }}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.title} — {option.path}</option>)}
          <option value="__new__">新建目录…</option>
        </select>
        {item.targetId === '__new__' ? (
          <input value={item.targetPath} style={{ ...S.input, flex: 1, minWidth: 220 }}
            placeholder="目标目录绝对路径"
            onChange={(event) => onChange({ targetPath: event.target.value, status: 'fallback' })} />
        ) : null}
        <Badge text={item.status === 'matched' ? '已匹配' : item.status === 'invalid' ? '目录非空' : '将新建'}
          tone={item.status === 'invalid' ? 'danger' : item.status === 'matched' ? 'ok' : 'neutral'} />
      </div>
    </div>
  )
}

function ResultView({ job, onClose }: { job: JobStatus | null; onClose: () => void }): ReactElement {
  const rows: readonly ResultRow[] = job?.result ?? []
  const imported = rows.filter((row) => row.status === 'imported').length
  const failed = rows.filter((row) => row.status === 'failed').length
  const cancelled = job?.state === 'cancelled'
  return (
    <>
      {cancelled ? (
        <div style={S.warnBox}>已取消，本次未导入任何会话；所有已写入的会话、附件与文件均已回滚。</div>
      ) : job?.state === 'failed' ? (
        <div style={S.errorBox}>导入批次失败：{job.error?.message ?? '未知错误'}</div>
      ) : (
        <div style={S.infoBox}>成功导入 {imported} 个会话{failed > 0 ? `，${failed} 个失败` : ''}。</div>
      )}
      {job?.warning === undefined ? null : <div style={S.warnBox}>{job.warning}</div>}
      <div style={S.statGrid}>
        <Stat label="成功" value={`${imported} 个`} />
        <Stat label="失败" value={`${failed} 个`} />
        <Stat label="状态" value={cancelled ? '已取消并回滚' : job?.state === 'failed' ? '失败' : '完成'} />
      </div>
      {rows.length > 0 ? (
        <div style={{ ...S.listBox, maxHeight: 260, marginTop: 12 }}>
          {rows.map((row, index) => (
            <div key={`${row.sessionId}-${index}`} style={S.resultRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.title}
                </div>
                <div style={S.sessionMeta}>
                  {row.reason ?? ''}
                  {row.versionNote === undefined ? '' : ` · ${row.versionNote}`}
                  {row.filesRestored === undefined ? '' : ` · 文件还原 ${row.filesRestored} 个`}
                  {row.attachmentsRestored === undefined ? '' : ` · 附件还原 ${row.attachmentsRestored} 个`}
                  {row.missingAttachments === undefined || row.missingAttachments.length === 0
                    ? '' : ` · 缺失附件 ${row.missingAttachments.length} 个`}
                </div>
              </div>
              <Badge text={row.status === 'imported' ? '已导入' : row.status === 'failed' ? '失败' : '未导入'}
                tone={row.status === 'imported' ? 'ok' : row.status === 'failed' ? 'danger' : 'neutral'} />
            </div>
          ))}
        </div>
      ) : null}
      <div style={S.footerRow}>
        <span style={S.hint}>导入的会话已绑定当前账号；如提示绑定失败，请重新登录后重试。</span>
        <button type="button" style={S.primaryButton} onClick={onClose}>完成</button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 样式（全部走官方 CSS 变量 + 浅色 fallback，深浅主题由宿主决定）
// ---------------------------------------------------------------------------

const S: Record<string, CSSProperties> = {
  page: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
    background: 'var(--dsw-alias-bg-base, #fff)',
    color: 'var(--dsw-alias-label-primary, #171717)',
  },
  pageHeader: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px',
    borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))', flexShrink: 0,
  },
  pageBody: { padding: '18px 20px 28px', overflow: 'auto', flex: 1, minHeight: 0 },
  tabs: { display: 'flex', gap: 4, marginLeft: 'auto' },
  tab: {
    border: 'none', background: 'transparent', cursor: 'pointer', padding: '6px 14px',
    borderRadius: 8, fontSize: 13, color: 'var(--dsw-alias-label-secondary, #6b6b6b)',
  },
  tabActive: { background: 'var(--dsw-alias-bg-hover, #f1f1f1)', color: 'var(--dsw-alias-label-primary, #171717)', fontWeight: 600 },
  steps: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 18 },
  stepDot: {
    width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, background: 'var(--dsw-alias-bg-hover, #eee)', color: 'var(--dsw-alias-label-tertiary, #9a9a9a)', flexShrink: 0,
  },
  stepDotActive: { background: 'var(--dsw-alias-fill-brand, #4d53e0)', color: '#fff' },
  stepLine: { flex: 1, height: 1, background: 'var(--dsw-alias-border-l1, rgba(0,0,0,.1))' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  input: {
    flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))',
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #171717)',
  },
  textarea: {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, resize: 'vertical',
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))',
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #171717)',
    fontFamily: 'monospace', boxSizing: 'border-box',
  },
  select: {
    padding: '7px 9px', borderRadius: 8, fontSize: 12, maxWidth: 300,
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))',
    background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, #171717)',
  },
  listBox: {
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))', borderRadius: 10,
    overflow: 'auto', maxHeight: 380,
  },
  groupHeader: {
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
    background: 'var(--dsw-alias-bg-hover, #f7f7f7)',
    display: 'flex', alignItems: 'center', gap: 8,
    position: 'sticky', top: 0, zIndex: 1,
  },
  groupToggle: {
    width: 18, height: 18, padding: 0, lineHeight: '18px', fontSize: 12,
    border: 'none', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
    background: 'transparent', color: 'var(--dsw-alias-label-secondary, #6b6b6b)',
    transition: 'transform .15s ease',
  },
  groupTitle: { flexShrink: 0 },
  groupPath: {
    fontWeight: 400, flex: 1, minWidth: 0,
    color: 'var(--dsw-alias-label-tertiary, #9a9a9a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  groupFileToggle: {
    display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontWeight: 400,
    fontSize: 11, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary, #6b6b6b)',
  },
  groupFileToggleDisabled: { cursor: 'not-allowed', opacity: 0.45 },
  groupAction: {
    padding: '2px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', flexShrink: 0,
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.16))',
    background: 'transparent', color: 'var(--dsw-alias-label-primary, #171717)',
  },
  sessionRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
    borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))',
  },
  sessionRowDisabled: { opacity: 0.55, cursor: 'not-allowed' },
  sessionMeta: { display: 'block', fontSize: 11, marginTop: 2, color: 'var(--dsw-alias-label-tertiary, #9a9a9a)' },
  badge: {
    fontSize: 11, padding: '2px 7px', borderRadius: 6,
    background: 'var(--dsw-alias-bg-hover, #f1f1f1)', whiteSpace: 'nowrap',
  },
  optionsBox: {
    marginTop: 12, padding: 12, borderRadius: 10,
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))',
  },
  hint: { display: 'block', fontSize: 11, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary, #6b6b6b)' },
  footerRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, justifyContent: 'flex-end' },
  primaryButton: {
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: 'var(--dsw-alias-fill-brand, #4d53e0)', color: '#fff',
  },
  ghostButton: {
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.16))',
    background: 'transparent', color: 'var(--dsw-alias-label-primary, #171717)',
  },
  dangerButton: {
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: '#e5484d', color: '#fff',
  },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 },
  statCard: {
    padding: '10px 12px', borderRadius: 10,
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))',
    background: 'var(--dsw-alias-bg-base, #fff)',
  },
  errorBox: {
    padding: '10px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, marginBottom: 12,
    background: 'rgba(229,72,77,.1)', color: 'var(--dsw-alias-state-error-primary, #c62828)',
  },
  warnBox: {
    padding: '10px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.6, marginTop: 10,
    background: 'rgba(180,83,9,.1)', color: '#b45309',
  },
  infoBox: {
    padding: '10px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.6, marginTop: 10,
    background: 'var(--dsw-alias-bg-hover, #f5f5f5)', color: 'var(--dsw-alias-label-secondary, #4b4b4b)',
  },
  centerBox: {
    padding: '28px 20px', textAlign: 'center', borderRadius: 10,
    border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1))',
  },
  track: { height: 8, borderRadius: 4, background: 'var(--dsw-alias-bg-hover, #eee)', overflow: 'hidden' },
  fill: { height: '100%', background: 'var(--dsw-alias-fill-brand, #4d53e0)', transition: 'width .3s ease' },
  dropZone: {
    border: '2px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.2))', borderRadius: 14,
    padding: '38px 20px', textAlign: 'center',
    color: 'var(--dsw-alias-label-secondary, #6b6b6b)',
  },
  dropZoneActive: { borderColor: 'var(--dsw-alias-fill-brand, #4d53e0)', background: 'rgba(77,83,224,.06)' },
  fileChip: {
    marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12,
    background: 'var(--dsw-alias-bg-hover, #f1f1f1)',
  },
  sectionTitle: { fontSize: 13, fontWeight: 600, margin: '16px 0 8px' },
  mappingRow: {
    padding: 12, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))',
  },
  radioGroup: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  radioRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' },
  resultRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))',
  },
  empty: { padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--dsw-alias-label-tertiary, #9a9a9a)' },
}

