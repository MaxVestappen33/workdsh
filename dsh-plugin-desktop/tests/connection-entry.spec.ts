import { expect, it } from 'vitest'
import { connectionEntryHtml, connectionLoadingHtml } from '../src/connection-entry.ts'

it('renders separate entry choices without permitting configured address HTML injection', () => {
  const html = connectionEntryHtml('\"><script>attack()</script>')
  expect(html).toContain('workdsh://personal')
  expect(html).toContain('workdsh://enterprise')
  expect(html).toContain('prefers-color-scheme:dark')
  expect(html).toContain("default-src 'none'")
  expect(html).not.toContain('<script>')
})

it('shows an accessible loading state with reduced-motion support and escaped text', () => {
  const html = connectionLoadingHtml('<script>unsafe()</script>')
  expect(html).toContain('aria-busy="true"')
  expect(html).toContain('role="status"')
  expect(html).toContain('prefers-reduced-motion')
  expect(html).not.toContain('<script>unsafe()')
  expect(html).not.toContain('<form')
})
