import { describe, expect, it } from 'vitest'
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, type Stats } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizeAsarEntry, verifyPackagedOwnedExports } from '../scripts/verify-workdsh-carrier.ts'

// Use electron-builder's real matcher without importing its unrelated target
// declaration graph (the published SnapOptions declaration has a missing file).
const { FileMatcher } = createRequire(import.meta.url)('app-builder-lib/out/fileMatcher.js') as {
  FileMatcher: new (from: string, to: string, expand: (pattern: string) => string, patterns: string[]) => {
    createFilter(): (path: string, stat: Stats) => boolean
  }
}

describe('ASAR inventory paths', () => {
  it('recognizes the Electron entry point on Windows and macOS', () => {
    expect(normalizeAsarEntry('\\lib\\workdsh-main.js')).toBe('lib/workdsh-main.js')
    expect(normalizeAsarEntry('/lib/workdsh-main.js')).toBe('lib/workdsh-main.js')
    expect(normalizeAsarEntry('\\node_modules\\@deepseek-ai\\dsh\\package.json'))
      .toBe('node_modules/@deepseek-ai/dsh/package.json')
  })
})

describe('final copied public SDK exports', () => {
  it('uses the real resource filter to preserve declarations, and rejects a missing copied SDK type', () => {
    const root = mkdtempSync(join(tmpdir(), 'workdsh-copied-sdk-'))
    const source = join(root, 'build/workdsh-runtime')
    const resources = join(root, 'WorkDSH.app/Contents/Resources/workdsh-runtime')
    const relativeProfile = 'profiles/workdsh'
    const sdk = 'workdsh-plugin-workbenches'
    const relativePackage = join(relativeProfile, 'node_modules', sdk)
    try {
      const files: Record<string, string> = {
        'package.json': JSON.stringify({ name: sdk, exports: {
          '.': { types: './dist/index.d.ts', default: './dist/index.js' },
          './client': { types: './dist/client.d.mts', default: './dist/client.browser.js' },
          './compat': { types: './dist/compat.d.cts', default: './dist/compat.cjs' },
        } }),
        'dist/index.d.ts': 'export interface Host {}',
        'dist/index.js': 'export {};',
        'dist/client.d.mts': 'export interface Client {}',
        'dist/client.browser.js': '',
        'dist/compat.d.cts': 'export interface Compat {}',
        'dist/compat.cjs': 'module.exports={};',
      }
      for (const [file, text] of Object.entries(files)) {
        const target = join(source, relativePackage, file)
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text)
      }
      const officialType = join(relativeProfile, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/index.d.ts')
      mkdirSync(dirname(join(source, officialType)), { recursive: true })
      writeFileSync(join(source, officialType), 'export interface OfficialConversation {}')
      const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        build: { extraResources: Array<{ from: string; filter?: string[] }> }
      }
      const patterns = manifest.build.extraResources.find(item => item.from === 'build/workdsh-runtime')?.filter
      expect(patterns).toBeDefined()
      const filter = new FileMatcher(source, resources, pattern => pattern, patterns!).createFilter()
      cpSync(source, resources, { recursive: true, filter: path => path === source || filter(path, lstatSync(path)) })
      const copiedProfile = join(resources, relativeProfile)
      expect(() => verifyPackagedOwnedExports(copiedProfile, [sdk])).not.toThrow()
      expect(readFileSync(join(resources, officialType), 'utf8')).toContain('OfficialConversation')
      rmSync(join(resources, relativePackage, 'dist/index.d.ts'))
      expect(() => verifyPackagedOwnedExports(copiedProfile, [sdk])).toThrow('Missing built export ./dist/index.d.ts')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
