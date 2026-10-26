/** 主进程推送给更新窗口的只读视图；不包含 URL、路径或原始异常。 */
export interface UpdateView {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'
  readonly version?: string
  readonly releaseType?: string
  readonly percent?: number
  readonly notesHtml?: string
  readonly mandatory?: boolean
  readonly failure?: { readonly operation: string; readonly code: string }
}
