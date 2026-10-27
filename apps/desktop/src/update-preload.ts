/** 更新窗口专用 preload：只暴露状态订阅与固定动作，不暴露任意 IPC。 */
import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateView } from './update-view.ts'

type WindowAction = 'minimize' | 'maximize' | 'close'

const api = {
  ready: (): Promise<UpdateView> => ipcRenderer.invoke('workdsh:update-ready') as Promise<UpdateView>,
  subscribe(listener: (view: UpdateView) => void): () => void {
    const handle = (_event: unknown, view: UpdateView): void => listener(view)
    ipcRenderer.on('workdsh:update-view', handle)
    return () => { ipcRenderer.off('workdsh:update-view', handle) }
  },
  action: (name: string): Promise<void> => ipcRenderer.invoke('workdsh:update-action', name) as Promise<void>,
  windowAction: (name: WindowAction): Promise<boolean> => ipcRenderer.invoke('workdsh:update-window', name) as Promise<boolean>,
  onMaximized(listener: (maximized: boolean) => void): () => void {
    const handle = (_event: unknown, maximized: boolean): void => listener(maximized)
    ipcRenderer.on('workdsh:update-maximized', handle)
    return () => { ipcRenderer.off('workdsh:update-maximized', handle) }
  },
}

contextBridge.exposeInMainWorld('workdshUpdate', api)

const FAILURE_TEXT: Record<string, string> = {
  network: '网络不可用，请检查内网连接后重试。',
  timeout: '连接后台超时，请稍后重试。',
  'server-error': '后台服务暂时不可用，请稍后重试。',
  'invalid-response': '后台返回的数据无法识别，请联系管理员。',
  'size-mismatch': '安装包大小与后台记录不一致，请重试。',
  'hash-mismatch': '安装包校验失败，请重试。',
  'disk-insufficient': '磁盘空间不足，请清理后重试。',
  'write-failed': '无法写入安装包，请检查磁盘或安全软件。',
  'host-stop-failed': '无法停止本机任务，更新尚未安装。',
  'installer-failed': '安装程序启动失败，请稍后重试。',
  cancelled: '下载已取消。',
}

const TYPE_TEXT: Record<string, string> = { stable: '正式版', beta: '公测版', alpha: '内测版' }

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

/** 字节数转人类可读体积；后台字段可能缺失，调用方负责判空。 */
function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

window.addEventListener('DOMContentLoaded', () => {
  const head = element<HTMLElement>('head')
  const badge = element<HTMLElement>('badge')
  const title = element<HTMLElement>('h1')
  const meta = element<HTMLElement>('meta')
  const notesWrap = element<HTMLElement>('notesWrap')
  const notes = element<HTMLElement>('notes')
  const upgrading = element<HTMLElement>('upgrading')
  const upTitle = element<HTMLElement>('upTitle')
  const upSub = element<HTMLElement>('upSub')
  const upBar = element<HTMLElement>('upBar')
  const upStatus = element<HTMLElement>('upStatus')
  const latest = element<HTMLElement>('latest')
  const latestTitle = element<HTMLElement>('latestTitle')
  const latestMeta = element<HTMLElement>('latestMeta')
  const latestChecks = element<HTMLElement>('latestChecks')
  const primary = element<HTMLButtonElement>('primary')
  const secondary = element<HTMLButtonElement>('secondary')
  const closeButton = element<HTMLButtonElement>('close')
  const maximizeButton = element<HTMLButtonElement>('max')
  let current: UpdateView | undefined

  const action = (name: string): void => { void api.action(name) }

  primary?.addEventListener('click', () => {
    if (current === undefined) return
    if (current.phase === 'available') action('upgrade')
    else if (current.phase === 'error') action('retry')
    else if (current.phase === 'idle') action('close')
  })
  secondary?.addEventListener('click', () => {
    if (current === undefined) return
    // “稍后”只收起弹窗：左下角提醒条继续保留，用户随时能从提醒条重启升级。
    action('close')
  })
  element<HTMLButtonElement>('min')?.addEventListener('click', () => { void api.windowAction('minimize') })
  closeButton?.addEventListener('click', () => { void api.windowAction('close') })
  maximizeButton?.addEventListener('click', () => {
    void api.windowAction('maximize').then(maximized => setMaximized(maximized))
  })

  const setMaximized = (maximized: boolean): void => {
    if (maximizeButton === null) return
    maximizeButton.textContent = maximized ? '\u2750' : '\u25a1'
    maximizeButton.title = maximized ? '还原' : '最大化'
    maximizeButton.setAttribute('aria-label', maximizeButton.title)
  }
  api.onMaximized(setMaximized)

  const show = (node: HTMLElement | null, visible: boolean): void => {
    if (node !== null) node.hidden = !visible
  }

  const setButton = (
    button: HTMLButtonElement | null,
    label: string | undefined,
    visible: boolean,
    variant: 'primary' | 'ghost' | 'default' = 'ghost',
  ): void => {
    if (button === null) return
    button.hidden = !visible
    button.className = variant === 'primary' ? 'btn primary' : variant === 'ghost' ? 'btn ghost' : 'btn'
    if (label !== undefined) button.textContent = label
  }

  const releaseMeta = (view: UpdateView): string => {
    const parts: string[] = []
    if (view.size !== undefined && view.size > 0) parts.push(formatSize(view.size))
    if (view.publishedAt !== undefined && view.publishedAt.length > 0) parts.push(`${view.publishedAt} 发布`)
    parts.push(TYPE_TEXT[view.releaseType ?? 'stable'] ?? '正式版')
    return parts.join(' · ')
  }

  const renderNotes = (view: UpdateView): void => {
    const hasNotes = view.notesHtml !== undefined && view.notesHtml.length > 0
    show(notesWrap, hasNotes)
    if (notes !== null && hasNotes) {
      // notesHtml 由主进程用受限 Markdown 渲染器生成，所有原始 HTML 均已转义。
      notes.innerHTML = view.notesHtml ?? ''
    }
  }

  /** 下载、校验、安装共用一个“正在更新”页：从确认到重启只有这一屏。 */
  const renderUpgrading = (options: {
    readonly heading: string
    readonly sub: string
    readonly status: string
    readonly percent?: number
  }): void => {
    show(head, false)
    show(notesWrap, false)
    show(latest, false)
    show(upgrading, true)
    if (upTitle !== null) upTitle.textContent = options.heading
    if (upSub !== null) upSub.textContent = options.sub
    if (upStatus !== null) upStatus.textContent = options.status
    if (upBar !== null) {
      const determinate = options.percent !== undefined
      upBar.className = determinate ? 'bar' : 'bar indeterminate'
      upBar.style.width = determinate ? `${Math.min(100, Math.max(0, options.percent ?? 0))}%` : ''
    }
    setButton(primary, undefined, false)
    setButton(secondary, undefined, false)
  }

  const renderEmptyState = (heading: string): void => {
    show(head, false)
    show(notesWrap, false)
    show(upgrading, false)
    show(latest, true)
    if (latestTitle !== null) latestTitle.textContent = heading
    if (latestMeta !== null) latestMeta.textContent = ''
    if (latestChecks !== null) latestChecks.textContent = ''
  }

  const render = (view: UpdateView): void => {
    current = view
    const hasVersion = view.version !== undefined && view.version.length > 0
    const mandatory = view.mandatory === true
    const upgradingPhase = view.phase === 'downloading'
      || view.phase === 'verifying'
      || view.phase === 'ready'
      || view.phase === 'installing'
    if (closeButton !== null) closeButton.disabled = mandatory || upgradingPhase

    show(badge, mandatory && hasVersion && view.phase === 'available')
    show(head, true)
    show(latest, false)
    show(notesWrap, false)
    show(upgrading, false)

    switch (view.phase) {
      case 'checking':
        renderEmptyState('正在检查更新…')
        if (latestChecks !== null) latestChecks.textContent = '正在连接更新服务'
        setButton(primary, undefined, false)
        setButton(secondary, undefined, false)
        return
      case 'idle':
        renderEmptyState(`警务助手 ${view.currentVersion ?? ''} 已是最新版`.trim())
        setButton(primary, '我知道啦', true, 'primary')
        setButton(secondary, undefined, false)
        return
      case 'available':
        if (title !== null) title.textContent = `发现新版本 ${view.version ?? ''}`.trim()
        if (meta !== null) meta.textContent = releaseMeta(view)
        renderNotes(view)
        setButton(primary, '立即更新', true, 'primary')
        setButton(secondary, '稍后', !mandatory)
        return
      case 'downloading': {
        const percent = Math.min(100, Math.max(0, view.percent ?? 0))
        const sizeText = view.size === undefined ? '' : ` · ${formatSize(view.size)}`
        renderUpgrading({
          heading: '正在下载更新',
          sub: '下载完成后将自动安装并重启软件，请稍候…',
          status: `正在下载… ${Math.round(percent)}%${sizeText}`,
          percent,
        })
        return
      }
      case 'verifying':
        renderUpgrading({
          heading: '正在校验安装包',
          sub: '校验通过后将自动开始安装，请稍候…',
          status: '正在校验完整性与文件签名…',
        })
        return
      case 'ready':
        renderUpgrading({
          heading: '正在安装更新',
          sub: '更新即将完成，应用将自动重启，请稍候…',
          status: '正在准备安装…',
        })
        return
      case 'installing':
        renderUpgrading({
          heading: '正在安装更新',
          sub: '更新即将完成，应用将自动重启，请稍候…',
          status: '正在安装…',
        })
        return
      case 'error':
        if (title !== null) title.textContent = '更新失败'
        if (meta !== null) meta.textContent = FAILURE_TEXT[view.failure?.code ?? ''] ?? '更新失败，请稍后重试。'
        setButton(primary, '重试', true, 'primary')
        setButton(secondary, '关闭', true)
        return
    }
  }

  void api.ready().then(render).catch(() => {
    render({ phase: 'error', failure: { operation: 'check', code: 'invalid-response' } })
  })
  api.subscribe(render)
})
