/** Prepare public, administrator-selected deployment configuration for one package. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeploymentConfig } from '../src/deployment-config.ts'

export function prepareDeploymentConfig(outputDirectory: string, inputFile?: string): void {
  const output = join(outputDirectory, 'workdsh-config.json')
  // A personal build, or a failed company build, must never reuse another
  // organization's previously generated configuration.
  rmSync(output, { force: true })
  let input: unknown = {}
  if (inputFile) {
    try { input = JSON.parse(readFileSync(inputFile, 'utf8')) as unknown }
    catch { throw new Error('Deployment configuration must be a readable JSON file') }
  }
  const config = parseDeploymentConfig(input)
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(output, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

export default function beforePack(): void {
  const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  prepareDeploymentConfig(join(desktopRoot, 'build', 'deployment'), process.env.WORKDSH_DEPLOYMENT_CONFIG)
}
