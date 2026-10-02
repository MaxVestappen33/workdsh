import { expect, it } from 'vitest'
import { connectionEntryHtml } from '../src/connection-entry.ts'

it('renders separate entry choices without permitting configured address HTML injection', () => {
  const html = connectionEntryHtml('\"><script>attack()</script>')
  expect(html).toContain('workdsh://personal')
  expect(html).toContain('workdsh://enterprise')
  expect(html).toContain('prefers-color-scheme:dark')
  expect(html).toContain("default-src 'none'")
  expect(html).not.toContain('<script>')
})
