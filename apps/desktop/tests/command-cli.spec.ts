import { expect, it } from 'vitest'
import { resolve, join } from 'node:path'
import { selectCommandSpace } from '../src/command-cli.ts'
it('selects explicit personal space while enterprise is active and rejects an unavailable enterprise space', () => {
  const personalHome = resolve('test-personal'), root = resolve('test-enterprise')
  const active = { mode: 'enterprise' as const, root, home: join(root, 'dsh'), label: 'Company / A' }
  expect(selectCommandSpace({ personalHome, active }).home).toBe(active.home)
  expect(selectCommandSpace({ personalHome, active }, 'personal').home).toBe(personalHome)
  expect(() => selectCommandSpace({ personalHome }, 'enterprise')).toThrow()
  expect(() => selectCommandSpace({ personalHome, active: { ...active, home: personalHome } })).toThrow()
  expect(() => selectCommandSpace({ personalHome }, 'other')).toThrow()
})
