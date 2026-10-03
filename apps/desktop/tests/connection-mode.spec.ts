import { describe, expect, it } from 'vitest'
import { connectionPartition, enterpriseConnection } from '../src/connection-mode.ts'

describe('Desktop connection boundary', () => {
  it('keeps personal browser storage unchanged and separates enterprise origins', () => {
    expect(connectionPartition({ mode: 'personal' })).toBeUndefined()
    const a = connectionPartition(enterpriseConnection('https://example.test/'))
    expect(a).not.toMatch(/^persist:/)
    expect(a).not.toBe(connectionPartition(enterpriseConnection('https://other.test/')))
    expect(a).toBe(connectionPartition(enterpriseConnection('https://example.test:443/')))
  })
  it('allows loopback development but refuses insecure remote portals', () => {
    expect(enterpriseConnection('http://127.0.0.1:19104/').portalOrigin).toBe('http://127.0.0.1:19104')
    expect(() => enterpriseConnection('http://example.test/')).toThrow()
    expect(() => enterpriseConnection('file:///etc/passwd')).toThrow()
    expect(() => enterpriseConnection('javascript:alert(1)')).toThrow()
  })
  it('refuses credentials, bootstrap tokens and deep links as portal configuration', () => {
    for (const value of ['https://user:password@example.test/', 'https://example.test/?token=secret', 'https://example.test/#token', 'https://example.test/conversation']) {
      expect(() => enterpriseConnection(value)).toThrow()
    }
  })
})
