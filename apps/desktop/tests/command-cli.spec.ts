import { expect, it } from 'vitest'
import { resolve, join } from 'node:path'
import { selectCommandSpace } from '../src/command-cli.ts'
it('rejects every non-account command space while the carrier is account-only', () => {
  const personalHome = resolve('test-personal'), root = resolve('test-enterprise')
  const active = { mode: 'enterprise' as const, root, home: join(root, 'dsh'), label: 'Company / A' }
  expect(() => selectCommandSpace({ personalHome, active })).toThrow('仅支持账号登录')
  expect(() => selectCommandSpace({ personalHome, active }, 'personal')).toThrow('仅支持账号登录')
  expect(() => selectCommandSpace({ personalHome }, 'enterprise')).toThrow('仅支持账号登录')
  expect(() => selectCommandSpace({ personalHome }, 'other')).toThrow('仅支持账号登录')
})
