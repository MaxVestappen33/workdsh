import { expect, it } from 'vitest'
import {
  compareSemanticVersions,
  compareVersionStrings,
  isNewerVersion,
  parseSemanticVersion,
} from '../src/update-version.ts'

function order(left: string, right: string): number | undefined {
  const parsedLeft = parseSemanticVersion(left)
  const parsedRight = parseSemanticVersion(right)
  if (parsedLeft === undefined || parsedRight === undefined) return undefined
  return compareSemanticVersions(parsedLeft, parsedRight)
}

it('parses strict semantic versions and rejects malformed input', () => {
  expect(parseSemanticVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
  expect(parseSemanticVersion('3.0.0-rc.2')).toEqual({ major: 3, minor: 0, patch: 0, prerelease: ['rc', '2'] })
  expect(parseSemanticVersion('1.0.0+build.7')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: [] })

  for (const invalid of ['', '1', '1.2', '01.0.0', '1.01.0', '1.0.01', '1.0.0-01', 'v1.0.0', '1.0.0.0', ' 1.0.0', '99999999999999999999.0.0', undefined, null, 3]) {
    expect(parseSemanticVersion(invalid as unknown)).toBeUndefined()
  }
})

it('orders major, minor and patch numerically', () => {
  expect(order('1.0.0', '2.0.0')).toBe(-1)
  expect(order('2.1.0', '2.0.0')).toBe(1)
  expect(order('2.0.1', '2.0.0')).toBe(1)
  expect(order('2.0.0', '2.0.0')).toBe(0)
})

it('follows the semver prerelease precedence chain', () => {
  const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
  for (let index = 0; index < chain.length - 1; index += 1) {
    expect(order(chain[index]!, chain[index + 1]!)).toBe(-1)
    expect(order(chain[index + 1]!, chain[index]!)).toBe(1)
  }
})

it('ignores build metadata and compares prerelease identifiers as specified', () => {
  expect(compareVersionStrings('1.0.0+left', '1.0.0+right')).toBe(0)
  expect(compareVersionStrings('1.0.0-2', '1.0.0-11')).toBe(-1)
  expect(compareVersionStrings('1.0.0-1', '1.0.0-alpha')).toBe(-1)
  expect(compareVersionStrings('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
})

it('treats invalid versions as unknown instead of equal', () => {
  expect(compareVersionStrings('1.0.0', 'not-a-version')).toBeUndefined()
  expect(compareVersionStrings('not-a-version', '1.0.0')).toBeUndefined()
  expect(isNewerVersion('not-a-version', '1.0.0')).toBe(false)
})

it('only reports a strictly newer candidate', () => {
  expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true)
  expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
  expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
  expect(isNewerVersion('1.0.0-rc.3', '1.0.0-rc.2')).toBe(true)
  expect(isNewerVersion('1.0.0', '1.0.0-rc.3')).toBe(true)
})
