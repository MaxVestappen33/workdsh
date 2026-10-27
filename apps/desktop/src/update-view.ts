/** 主进程推送给更新窗口的只读视图；不包含 URL、路径或原始异常。 */
export interface UpdateView {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error'
  readonly version?: string
  readonly releaseType?: string
  readonly percent?: number
  readonly notesHtml?: string
  readonly mandatory?: boolean
  /** 安装包体积（字节），用于展示“已下载 / 总量”。 */
  readonly size?: number
  /** 后台发布时间的原样文本，仅用于展示。 */
  readonly publishedAt?: string
  /** 当前客户端版本，用于“已是最新版本”文案。 */
  readonly currentVersion?: string
  readonly failure?: { readonly operation: string; readonly code: string }
}
