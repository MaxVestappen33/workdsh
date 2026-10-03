import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

// Installers ship this Electron carrier and the bundled WorkDSH Profile only.
export default defineConfig([{
  entry: { 'workdsh-main': 'src/workdsh-main.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
}, {
  entry: { 'connection-preload': 'src/connection-preload.ts' },
  outDir: 'lib', format: 'cjs', platform: 'node', target: 'es2024',
  fixedExtension: true, dts: false, clean: false,
}, {
  entry: { 'command-cli': 'src/command-cli.ts' }, outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false,
}, {
  entry: { 'command-worker': 'scripts/command-worker.mjs' }, outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
  alias: { '@deepseek-ai/dsh-atomic-write': fileURLToPath(new URL('../deepseek-harness/packages/util/atomic-write/src/index.ts', import.meta.url)) },
}])
