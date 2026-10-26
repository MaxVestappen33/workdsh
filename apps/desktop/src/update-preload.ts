/** 更新窗口专用 preload：只暴露状态订阅与四个动作，不暴露任意 IPC。 */
import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateView } from './update-view.ts'

const api = {
  ready: (): Promise<UpdateView> => ipcRenderer.invoke('workdsh:update-ready') as Promise<UpdateView>,
  subscribe(listener: (view: UpdateView) => void): () => void {
    const handle = (_event: unknown, view: UpdateView): void => listener(view)
    ipcRenderer.on('workdsh:update-view', handle)
    return () => { ipcRenderer.off('workdsh:update-view', handle) }
  },
  action: (name: string): Promise<void> => ipcRenderer.invoke('workdsh:update-action', name) as Promise<void>,
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

window.addEventListener('DOMContentLoaded', () => {
  const version = element<HTMLElement>('version')
  const type = element<HTMLElement>('type')
  const status = element<HTMLElement>('status')
  const progress = element<HTMLElement>('progress')
  const bar = element<HTMLElement>('bar')
  const notes = element<HTMLElement>('notes')
  const primary = element<HTMLButtonElement>('primary')
  const secondary = element<HTMLButtonElement>('secondary')
  let current: UpdateView | undefined

  const action = (name: string): void => { void api.action(name) }

  primary?.addEventListener('click', () => {
    if (current === undefined) return
    if (current.phase === 'available') action('download')
    else if (current.phase === 'ready') action('install')
    else if (current.phase === 'error') action('retry')
  })
  secondary?.addEventListener('click', () => {
    if (current === undefined) return
    if (current.phase === 'downloading') action('cancel')
    else if (current.phase === 'available' || current.phase === 'ready') action('dismiss')
    else action('close')
  })

  const setButton = (button: HTMLButtonElement | null, label: string | undefined, visible: boolean): void => {
    if (button === null) return
    button.hidden = !visible
    if (label !== undefined) button.textContent = label
  }

  const render = (view: UpdateView): void => {
    current = view
    const hasVersion = view.version !== undefined && view.version.length > 0
    if (version !== null) {
      version.hidden = !hasVersion
      version.textContent = hasVersion ? `版本 ${view.version}` : ''
    }
    if (type !== null) {
      const releaseType = view.releaseType ?? 'stable'
      type.hidden = !hasVersion
      type.textContent = TYPE_TEXT[releaseType] ?? releaseType
      type.className = `badge ${releaseType}`
    }

    progress!.hidden = view.phase !== 'downloading' && view.phase !== 'verifying'
    if (bar !== null) {
      const percent = view.phase === 'verifying' ? 100 : (view.percent ?? 0)
      bar.style.width = `${Math.min(100, Math.max(0, percent))}%`
    }

    if (notes !== null) {
      // notesHtml 由主进程用受限 Markdown 渲染器生成，所有原始 HTML 均已转义。
      notes.hidden = view.notesHtml === undefined || view.notesHtml.length === 0
      notes.innerHTML = view.notesHtml ?? ''
    }

    switch (view.phase) {
      case 'idle':
        status!.textContent = '当前已是最新版本。'
        status!.className = 'status'
        setButton(primary, undefined, false)
        setButton(secondary, '关闭', true)
        break
      case 'checking':
        status!.textContent = '正在检查更新…'
        status!.className = 'status'
        setButton(primary, undefined, false)
        setButton(secondary, '关闭', true)
        break
      case 'available':
        status!.textContent = view.mandatory === true ? '发现新版本（强制更新）。' : '发现新版本。'
        status!.className = 'status strong'
        setButton(primary, '下载更新', true)
        setButton(secondary, view.mandatory === true ? undefined : '稍后', view.mandatory !== true)
        break
      case 'downloading':
        status!.textContent = `正在下载更新：${view.percent ?? 0}%`
        status!.className = 'status'
        setButton(primary, undefined, false)
        setButton(secondary, '取消', true)
        break
      case 'verifying':
        status!.textContent = '正在校验更新文件…'
        status!.className = 'status'
        setButton(primary, undefined, false)
        setButton(secondary, undefined, false)
        break
      case 'ready':
        status!.textContent = '新版本已准备就绪，安装期间应用会暂时关闭。'
        status!.className = 'status strong'
        setButton(primary, '安装并重启', true)
        setButton(secondary, view.mandatory === true ? undefined : '稍后', view.mandatory !== true)
        break
      case 'installing':
        status!.textContent = '正在准备重启…'
        status!.className = 'status'
        setButton(primary, undefined, false)
        setButton(secondary, undefined, false)
        break
      case 'error':
        status!.textContent = FAILURE_TEXT[view.failure?.code ?? ''] ?? '更新失败，请稍后重试。'
        status!.className = 'status'
        setButton(primary, '重试', true)
        setButton(secondary, '关闭', true)
        break
    }
  }

  void api.ready().then(render).catch(() => {
    render({ phase: 'error', failure: { operation: 'check', code: 'invalid-response' } })
  })
  api.subscribe(render)
})
