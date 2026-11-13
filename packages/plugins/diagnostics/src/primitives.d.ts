/**
 * 官方 primitives 的最小类型声明。
 *
 * 该包由 Profile 运行时提供（与官方会话头部同一个组件库），不在本包的 npm 依赖里安装，
 * 因此这里只声明实际用到的导出，形态以官方 client 的用法为准。
 * 构建时 esbuild 把它标为 external，运行时从同一 node_modules 解析。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement, ReactElement as Element, ReactNode } from 'react'

  export function Button(props: {
    size?: 'sm' | 'md'
    variant?: 'primary' | 'secondary'
    children?: ReactNode
    style?: Record<string, string | number>
    onClick?: () => void
    'aria-label'?: string
    'aria-haspopup'?: string
    'aria-expanded'?: boolean
    'aria-busy'?: boolean
  }): ReactElement

  export function Tooltip(props: {
    label: ReactNode
    side?: 'top' | 'right' | 'bottom' | 'left'
    align?: 'start' | 'center' | 'end'
    disabled?: boolean
    children: Element
  }): ReactElement

  export function IconDownloadOutlineRegular(props: { size?: number }): ReactElement
}
