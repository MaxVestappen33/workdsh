import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconDownloadOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useState, type ReactElement } from 'react'

export const name = 'workdsh-plugin-diagnostics-client'
export const inject = ['slots']

const EXPORT_PATH = '/api/workdsh.diagnostics.export'

/**
 * `conversation.session.header.utilities` 是 `kind: "list"`：官方 open-in-app（order -10）、
 * schedule（order -5）、session-log-export（默认 0）依次渲染。这里用 order -1 插在官方“…”左侧，
 * 只注册自己的图标按钮；官方“…”菜单与下载弹窗保持原样，不由我们渲染。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
    {
      name: 'conversation.session.header.utilities',
      id: 'workdsh-diagnostics-export',
      order: -1,
    },
    DiagnosticsExportButton as never,
  ))
}

interface DiagnosticsExportButtonProps {
  sessionId: string
}

/** 会话头部独立按钮：点击直接把诊断包交给浏览器下载。 */
export function DiagnosticsExportButton({ sessionId }: DiagnosticsExportButtonProps): ReactElement {
  const [error, setError] = useState<string | null>(null)

  const exportDiagnostics = useCallback(async (): Promise<void> => {
    const route = `${EXPORT_PATH}?${new URLSearchParams({ sessionId }).toString()}`
    try {
      const probe = await fetch(route, { method: 'HEAD' })
      if (!probe.ok) throw new Error(`HTTP ${probe.status} ${await probe.text().catch(() => '')}`.trim())
      const anchor = document.createElement('a')
      anchor.href = route
      anchor.download = ''
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [sessionId])

  return (
    <Tooltip label={error ?? '下载诊断包'} side="bottom">
      <Button
        size="sm"
        aria-label={error ?? '下载诊断包'}
        onClick={() => void exportDiagnostics()}
        style={{ width: 28, padding: 0, color: 'var(--dsw-alias-label-secondary)' }}
      >
        <IconDownloadOutlineRegular />
      </Button>
    </Tooltip>
  )
}
