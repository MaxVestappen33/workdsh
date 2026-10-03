import { expect, it } from 'vitest'
import { parseDeploymentConfig } from '../src/deployment-config.ts'
import { connectionEntryHtml, enterpriseLoginHtml } from '../src/connection-entry.ts'

it('accepts only an administrator backend origin and normalizes it', () => {
  expect(parseDeploymentConfig({})).toEqual({})
  expect(parseDeploymentConfig({ enterprise: { backendUrl: 'https://company.test/' } })).toEqual({ enterprise: { backendUrl: 'https://company.test' } })
  expect(parseDeploymentConfig({ enterprise: { backendUrl: 'http://127.0.0.1:19490' } })).toEqual({ enterprise: { backendUrl: 'http://127.0.0.1:19490' } })
  for (const config of [null, [], { apiKey: 'secret' }, { enterprise: { backendUrl: 'https://company.test', apiKey: 'secret' } }, { enterprise: { backendUrl: 'http://company.test' } }, { enterprise: { backendUrl: 'https://company.test/login?token=secret' } }]) {
    expect(() => parseDeploymentConfig(config)).toThrow()
  }
})

it('shows a fixed administrator backend and no plugin installation step', () => {
  const entry = connectionEntryHtml('https://company.test', true)
  expect(entry).toContain('<p>https://company.test</p>')
  expect(entry).not.toContain('name="portal"')
  expect(entry).toContain('企业登录')
  const login = enterpriseLoginHtml('https://company.test')
  expect(login).not.toContain('install-plugin')
  expect(login).not.toContain('选择并安装')
})
