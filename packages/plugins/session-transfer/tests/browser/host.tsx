/* 浏览器宿主：加载插件「真实产物」dist/client.browser.js 并挂载到真实 React 19 运行时。
 * 只 stub 宿主提供的部分（slots 容器 / layout 服务 / 官方 primitives），插件 UI 代码本身完全真实。 */
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'

type Component = (props: any) => any
type Registration = { name: string; options: Record<string, unknown>; component: Component }

const registered = new Map<string, Registration>()

const primitivesStub = {
  MenuItemButton: ({ icon, onSelect, children }: any) =>
    React.createElement('button', {
      type: 'button',
      'data-testid': 'menu-item-button',
      onClick: () => onSelect?.(),
      style: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer' },
    }, icon, children),
}

const modules: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': { createRoot },
  'react/jsx-runtime': { jsx, jsxs, Fragment },
  '@deepseek-ai/dsh-client-ui-primitives': primitivesStub,
}

;(window as any).__ModuleLoader__ = {
  load(def: { id: string; factory: (require: (id: string) => unknown) => unknown }): void {
    const require = (id: string): unknown => {
      if (!(id in modules)) throw new Error(`[host] 未提供的模块: ${id}`)
      return modules[id]
    }
    ;(window as any).__transferExports = def.factory(require)
  },
}

let slotSeq = 0
function makeSlots() {
  return {
    inject(_name: string, factory: () => () => void): () => void {
      const cleanup = factory() // 立即执行 provider，触发内部 slots.register 登记组件
      return typeof cleanup === 'function' ? cleanup : () => undefined
    },
    register(options: Record<string, unknown>, component: unknown): () => void {
      // 真实框架按 slot name 分组，插件在多个 slot 复用同一 id；宿主用唯一 key 收集
      const key = `slot-${slotSeq++}:${String(options.name ?? '')}`
      registered.set(key, { name: String(options.name ?? ''), options, component: component as Component })
      return () => { registered.delete(key) }
    },
  }
}

/** layout 服务 stub：面板选择状态 + 订阅（模拟官方 ctx.layout.selectPanel）。 */
const layoutState = {
  panel: 'workdsh-session-transfer',
  listeners: new Set<() => void>(),
  selectPanel(id: string): void {
    layoutState.panel = id
    for (const listener of layoutState.listeners) listener()
  },
}

function useSelectedPanel(): string {
  const [, force] = React.useState(0)
  React.useEffect(() => {
    const listener = () => force((n) => n + 1)
    layoutState.listeners.add(listener)
    return () => { layoutState.listeners.delete(listener) }
  }, [])
  return layoutState.panel
}

function Host(): React.ReactElement {
  const selected = useSelectedPanel()
  const all = [...registered.values()]
  const find = (name: string): Registration | undefined => all.find((r) => r.name === name)
  const panelRow = find('sidebar.panellist')
  const menu = find('sidebar.workspaces.session.menu.item')
  const main = find('main')

  // 主面板组件：合并 inject 工厂返回值与运行时 props
  const renderMain = (): React.ReactNode => {
    if (main === undefined) return null
    const inject = main.options.inject
    const injected = typeof inject === 'function' ? (inject as () => Record<string, unknown>)() : {}
    return React.createElement(main.component, { ...injected, panelId: selected })
  }

  const frame: React.CSSProperties = {
    height: '100vh', background: '#f5f6f8', color: '#1f2329', fontFamily: 'system-ui, sans-serif',
    display: 'flex',
  }
  const bar: React.CSSProperties = {
    width: 230, background: '#fff', borderRight: '1px solid #e5e6eb', padding: 16, boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column',
  }
  return React.createElement('div', { style: frame, 'data-testid': 'app-frame' },
    React.createElement('aside', { style: bar, 'data-testid': 'host-sidebar' },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 16 } }, 'WorkDSH · 点击测试宿主'),
      React.createElement('div', { style: { fontSize: 12, color: '#86909c', marginBottom: 6 } }, '全局面板行'),
      React.createElement('button', {
        type: 'button', 'data-testid': 'host-library-row',
        onClick: () => layoutState.selectPanel('workdsh-library'),
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer' },
      }, '资料库'),
      panelRow === undefined ? null : React.createElement('button', {
        type: 'button', 'data-testid': 'host-transfer-row',
        onClick: () => layoutState.selectPanel('workdsh-session-transfer'),
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer' },
      },
      React.createElement(panelRow.component, { size: 16, active: selected === 'workdsh-session-transfer' }),
      '会话迁移'),
      React.createElement('div', { style: { fontSize: 12, color: '#86909c', marginTop: 16, marginBottom: 6 } }, '会话（右键菜单）'),
      React.createElement('div', { 'data-testid': 'host-session-menu' },
        menu === undefined ? null : React.createElement(menu.component, {
          sessionId: 's1', displayTitle: '迁移测试会话',
          useMenuOpenState: () => [false, () => undefined] as const,
        })),
    ),
    React.createElement('main', { style: { flex: 1, minWidth: 0, display: 'flex' }, 'data-testid': 'host-main' },
      selected === 'workdsh-session-transfer'
        ? renderMain()
        : React.createElement('div', { style: { padding: 24, fontSize: 13, color: '#86909c' } }, `当前面板：${selected}`)),
  )
}

;(window as any).__boot = (): void => {
  const exports = (window as any).__transferExports
  if (exports?.apply === undefined) throw new Error('[host] 插件产物未导出 apply()')
  exports.apply({ slots: makeSlots(), layout: layoutState } as any)
  const root = document.getElementById('root')
  if (root === null) throw new Error('[host] #root 缺失')
  createRoot(root).render(React.createElement(Host))
  ;(window as any).__booted = true
}
;(window as any).__registeredCount = (): number => registered.size
;(window as any).__selectPanel = (id: string): void => layoutState.selectPanel(id)
