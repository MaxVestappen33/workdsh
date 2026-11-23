import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Button, IconTrashOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'

export const name = 'workdsh-plugin-session-recycle-client'
export const inject = ['slots', 'sessions']

const DELETE_PATH = '/api/workdsh-session-delete'
const CARD_WIDTH = 300
const CARD_GAP = 14

interface SessionsLike {
  list: { getSnapshot(): { byId: Record<string, { retainedBy?: { mainView?: number } } | undefined> } }
  refresh(): Promise<void>
}

/**
 * 会话行菜单最后一项：只负责发起请求；确认气泡挂在 `shell.overlay`，
 * 不随菜单卸载，并按会话行位置显示在右侧。
 */
export function apply(ctx: Context): void {
  const sessions = ctx.sessions as unknown as SessionsLike
  let pending: string | null = null
  const listeners = new Set<() => void>()
  const read = (): string | null => pending
  const write = (sessionId: string | null): void => {
    pending = sessionId
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces.session.menu.item',
      id: 'workdsh-session-delete',
      order: 600,
    },
    (({ sessionId, useMenuOpenState }: MenuEntryProps) => {
      const [, setMenuOpen] = useMenuOpenState()
      return (
        <MenuItemButton
          danger
          separatorBefore
          icon={<IconTrashOutlineRegular />}
          onSelect={() => {
            setMenuOpen(false)
            write(sessionId)
          }}
        >
          删除会话
        </MenuItemButton>
      )
    }) as never,
  ))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'workdsh-session-delete-confirm',
      order: 600,
    },
    (() => (
      <DeleteConfirmHost
        sessions={sessions}
        subscribe={subscribe}
        read={read}
        clear={() => write(null)}
      />
    )) as never,
  ))
}

interface MenuEntryProps {
  sessionId: string
  displayTitle: string
  useMenuOpenState: () => readonly [boolean, (open: boolean) => void]
}

interface HostProps {
  sessions: SessionsLike
  subscribe: (listener: () => void) => () => void
  read: () => string | null
  clear: () => void
}

function DeleteConfirmHost({ sessions, subscribe, read, clear }: HostProps): ReactElement | null {
  const [sessionId, setSessionId] = useState(read)
  useEffect(() => subscribe(() => setSessionId(read())), [subscribe, read])
  if (sessionId === null) return null
  return <DeleteConfirmPopover key={sessionId} sessionId={sessionId} sessions={sessions} onClose={clear} />
}

interface ConfirmProps {
  sessionId: string
  sessions: SessionsLike
  onClose: () => void
}

/** 会话行右侧的确认气泡：小箭头指向被删除的会话，不再使用居中大弹窗。 */
function DeleteConfirmPopover({ sessionId, sessions, onClose }: ConfirmProps): ReactElement {
  const card = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<CSSProperties | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useLayoutEffect(() => {
    let frame = 0
    const update = (): void => {
      const row = document.querySelector<HTMLElement>(`[data-row-key="session:${sessionId}"]`)
      const rect = row?.getBoundingClientRect()
      const maxLeft = window.innerWidth - CARD_WIDTH - 16
      const left = Math.max(16, Math.min((rect?.right ?? 280) + CARD_GAP, maxLeft))
      const center = rect === undefined ? window.innerHeight / 2 : rect.top + rect.height / 2
      const top = Math.max(130, Math.min(center, window.innerHeight - 130))
      setPlacement({ left, top })
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [sessionId])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (card.current?.contains(target) === true) return
      const row = document.querySelector(`[data-row-key="session:${sessionId}"]`)
      if (row?.contains(target) === true) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [sessionId, onClose])

  const remove = useCallback(async (): Promise<void> => {
    const rows = sessions.list.getSnapshot().byId
    const currentId = Object.entries(rows).find(([, row]) => (row?.retainedBy?.mainView ?? 0) > 0)?.[0]
    if (currentId === sessionId) {
      setError('当前正在查看该会话，请先切换到其他会话再删除。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(DELETE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const payload = await response.json().catch(() => undefined) as
        | { error?: { message?: unknown; code?: unknown } }
        | undefined
      if (!response.ok) {
        const message = payload?.error?.message
        const code = payload?.error?.code
        if (typeof message === 'string' && message.length > 0) throw new Error(message)
        const suffix = typeof code === 'string' && code.length > 0 ? `（${code}）` : ''
        throw new Error(`删除失败（HTTP ${response.status}）${suffix}`)
      }
      await sessions.refresh()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [sessionId, sessions, onClose])

  if (placement === null) return <></>

  return createPortal(
    <div
      ref={card}
      style={{
        position: 'fixed',
        zIndex: 4000,
        left: placement.left,
        top: placement.top,
        width: CARD_WIDTH,
        transform: 'translateY(-50%)',
        filter: 'drop-shadow(0 10px 24px rgba(0, 0, 0, 0.16))',
      }}
    >
      <span aria-hidden style={ARROW} />
      <div style={CARD}>
        <div style={TITLE}>删除该会话？</div>
        <p style={DESCRIPTION}>删除后，该会话记录将从本机永久移除，且无法恢复。</p>
        {error === null ? null : <p role="alert" style={ERROR}>{error}</p>}
        <div style={FOOTER}>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void remove()}
            style={{ background: '#e5484d', borderColor: '#e5484d', color: '#fff', boxShadow: 'none' }}
          >
            {busy ? '正在删除…' : '删除'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const ARROW: CSSProperties = {
  position: 'absolute',
  left: -6,
  top: '50%',
  width: 12,
  height: 12,
  marginTop: -6,
  borderRadius: 2,
  background: 'var(--dsw-alias-bg-elevated, #fff)',
  transform: 'rotate(45deg)',
}

const CARD: CSSProperties = {
  position: 'relative',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-elevated, #fff)',
  border: '1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06))',
  padding: '20px 20px 18px',
  color: 'var(--dsw-alias-label-primary, #171717)',
}

const TITLE: CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  lineHeight: 1.4,
  marginBottom: 12,
}

const DESCRIPTION: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.65,
  color: 'var(--dsw-alias-label-secondary, #4b4b4b)',
  wordBreak: 'break-word',
}

const ERROR: CSSProperties = {
  margin: '10px 0 0',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-state-error-primary, #e5484d)',
}

const FOOTER: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 20,
}
