import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareDeploymentConfig } from '../scripts/prepare-deployment-config.ts'

describe('package deployment configuration', () => {
  it('prepares a company address and clears it before the next personal package', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workdsh-deployment-config-'))
    try {
      const input = join(directory, 'company.json')
      const output = join(directory, 'generated')
      writeFileSync(input, JSON.stringify({ enterprise: { backendUrl: 'https://company.test/' } }))
      prepareDeploymentConfig(output, input)
      expect(JSON.parse(readFileSync(join(output, 'workdsh-config.json'), 'utf8'))).toEqual({ enterprise: { backendUrl: 'https://company.test' } })
      prepareDeploymentConfig(output)
      expect(readFileSync(join(output, 'workdsh-config.json'), 'utf8')).toBe('{}\n')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('removes stale company configuration when the new input is unreadable or invalid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workdsh-deployment-invalid-'))
    try {
      const input = join(directory, 'company.json')
      const generated = join(directory, 'workdsh-config.json')
      writeFileSync(generated, JSON.stringify({ enterprise: { backendUrl: 'https://previous.test' } }))
      expect(() => prepareDeploymentConfig(directory, join(directory, 'missing.json'))).toThrow(/readable JSON/)
      expect(existsSync(generated)).toBe(false)
      writeFileSync(generated, JSON.stringify({ enterprise: { backendUrl: 'https://previous.test' } }))
      writeFileSync(input, JSON.stringify({ enterprise: { backendUrl: 'http://public.test' } }))
      expect(() => prepareDeploymentConfig(directory, input)).toThrow()
      expect(existsSync(generated)).toBe(false)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
