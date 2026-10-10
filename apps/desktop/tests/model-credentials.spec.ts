import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseModelCredentials, readModelCredentials } from '../src/model-credentials.ts'

describe('packaged model credentials', () => {
  it('accepts reference names whose values can be resolved at runtime', () => {
    expect(parseModelCredentials({ DEEPSEEK_V4_FLASH_API_KEY: 'sk-shared-access-value' })).toEqual({ DEEPSEEK_V4_FLASH_API_KEY: 'sk-shared-access-value' })
    expect(parseModelCredentials({})).toEqual({})
  })

  it('treats a blank value as not provided so a repository template can start safely', () => {
    expect(parseModelCredentials({ DEEPSEEK_V4_FLASH_API_KEY: '' })).toEqual({})
  })

  it('rejects reference names the official credential seam would refuse', () => {
    // credentialRef() 只接受 POSIX 标识符，其它写法会在运行时直接抛错。
    expect(() => parseModelCredentials({ 'sk-not-a-reference': 'value' })).toThrow(/POSIX/)
    expect(() => parseModelCredentials(['nope'])).toThrow(/JSON 对象/)
    expect(() => parseModelCredentials({ DEEPSEEK_V4_FLASH_API_KEY: null })).toThrow(/必须是字符串/)
  })

  it('lets the launching environment win over the packaged value', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workdsh-model-credentials-'))
    try {
      writeFileSync(join(directory, 'model-credentials.json'), JSON.stringify({ DEEPSEEK_V4_FLASH_API_KEY: 'packaged', OTHER_API_KEY: 'packaged' }))
      expect(readModelCredentials(directory, { DEEPSEEK_V4_FLASH_API_KEY: 'from-environment' })).toEqual({ OTHER_API_KEY: 'packaged' })
      expect(readModelCredentials(directory, {})).toEqual({ DEEPSEEK_V4_FLASH_API_KEY: 'packaged', OTHER_API_KEY: 'packaged' })
      expect(readModelCredentials(join(directory, 'absent'), {})).toEqual({})
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
