/** 严格 Semantic Versioning 2.0.0 的解析与比较；更新器不引入第三方 semver 依赖。 */

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

export interface SemanticVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** 预发布标识；空数组表示正式版。构建元数据不参与比较，因此不保留。 */
  readonly prerelease: readonly string[]
}

const MAX_VERSION_LENGTH = 128

/** 解析失败返回 undefined：版本号来自后台，必须严格拒绝非法值而不是猜测。 */
function numericIdentifier(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function parseSemanticVersion(value: unknown): SemanticVersion | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_VERSION_LENGTH) return undefined
  const match = VERSION_PATTERN.exec(value)
  if (match === null) return undefined
  const major = numericIdentifier(match[1])
  const minor = numericIdentifier(match[2])
  const patch = numericIdentifier(match[3])
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  const prerelease = match[4] === undefined || match[4] === '' ? [] : match[4].split('.')
  return { major, minor, patch, prerelease }
}

/** 数字标识按数值比较；数字标识低于字母标识；其余按 ASCII 字典序。 */
function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left)
  const rightNumeric = /^\d+$/u.test(right)
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right))
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** 有预发布标识的版本低于同版本正式版；标识逐段比较，前缀相同则短者更小。 */
function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const result = compareIdentifier(left[index]!, right[index]!)
    if (result !== 0) return result
  }
  return Math.sign(left.length - right.length)
}

export function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): -1 | 0 | 1 {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1
  const prerelease = comparePrerelease(left.prerelease, right.prerelease)
  return prerelease === 0 ? 0 : prerelease < 0 ? -1 : 1
}

/** 任一版本非法时返回 undefined；调用方据此关闭更新，而不是当作“相等”。 */
export function compareVersionStrings(left: string, right: string): -1 | 0 | 1 | undefined {
  const parsedLeft = parseSemanticVersion(left)
  const parsedRight = parseSemanticVersion(right)
  if (parsedLeft === undefined || parsedRight === undefined) return undefined
  return compareSemanticVersions(parsedLeft, parsedRight)
}

/** 仅当候选版本严格大于当前版本时返回 true；相等或更旧一律不提示。 */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersionStrings(candidate, current) === 1
}
