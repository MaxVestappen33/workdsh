/** 左下角更新提醒条专用 preload：只暴露状态订阅与三个动作。 */
import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateView } from './update-view.ts'

const api = {
  ready: (): Promise<UpdateView> => ipcRenderer.invoke('workdsh:update-toast-ready') as Promise<UpdateView>,
  subscribe(listener: (view: UpdateView) => void): () => void {
    const handle = (_event: unknown, view: UpdateView): void => listener(view)
    ipcRenderer.on('workdsh:update-view', handle)
    return () => { ipcRenderer.off('workdsh:update-view', handle) }
  },
  action: (name: 'notes' | 'restart' | 'dismiss'): Promise<void> =>
    ipcRenderer.invoke('workdsh:update-toast-action', name) as Promise<void>,
}

contextBridge.exposeInMainWorld('workdshUpdateToast', api)

window.addEventListener('DOMContentLoaded', () => {
  const label = document.getElementById('label')
  const notes = document.getElementById('notes')
  const restart = document.getElementById('restart')
  const close = document.getElementById('close')

  const act = (name: 'notes' | 'restart' | 'dismiss'): void => { void api.action(name) }
  notes?.addEventListener('click', () => act('notes'))
  restart?.addEventListener('click', () => act('restart'))
  close?.addEventListener('click', () => act('dismiss'))

  const render = (view: UpdateView): void => {
    if (label === null) return
    // 已下载完成用“就绪”，刚检出用“发现新版本”；两种状态都由主进程判定后下发。
    label.textContent = view.phase === 'ready'
      ? '新版本已就绪'
      : `发现新版本 ${view.version ?? ''}`.trim()
  }

  void api.ready().then(render).catch(() => undefined)
  api.subscribe(render)
})
