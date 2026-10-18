import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const workflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
// Exercise the workflow's actual shell conditions, rather than maintaining
// another JavaScript copy of the path expressions.
const conditions = workflow.split('\n').filter(line => line.trimStart().startsWith('if [[')
  && line.includes('<<< "$changed_paths"; then '))
assert.equal(conditions.length, 2, 'CI must classify both Web and Desktop scope')
const shell = ['set -euo pipefail', ...conditions, 'printf "web=%s\\ndesktop=%s\\n" "$web" "$desktop"'].join('\n')

function scopes(paths) {
  const product = spawnSync(process.execPath, ['scripts/classify-ci-changes.mjs'], {
    cwd: root, input: paths.join('\0') + '\0', encoding: 'utf8',
  })
  assert.equal(product.status, 0, product.stderr)
  const result = spawnSync('bash', ['-c', shell], {
    cwd: root,
    env: { ...process.env, changed_paths: paths.join('\n'), product: product.stdout.trim() },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim().split('\n')
}

for (const extension of ['mjs', 'json', 'd.mts']) {
  const path = `scripts/native-workbench-frame-patch.${extension}`
  test(`shared adapter ${extension} changes trigger Web integration and Desktop packaging`, () => {
    assert.deepEqual(scopes([path]), ['web=true', 'desktop=true'])
    const product = spawnSync(process.execPath, ['scripts/classify-ci-changes.mjs'], {
      cwd: root, input: path + '\0', encoding: 'utf8',
    })
    assert.equal(product.status, 0, product.stderr)
    assert.equal(product.stdout.trim(), 'true')
  })
}

test('shared and Web-only changes retain their existing delivery scope', () => {
  for (const path of ['packages/plugins/workbenches/src/client.tsx', 'profiles/shared/workdsh-features.json']) {
    assert.deepEqual(scopes([path]), ['web=true', 'desktop=true'])
  }
  assert.deepEqual(scopes(['apps/web/scripts/start-preview.mjs']), ['web=true', 'desktop=false'])
  assert.deepEqual(scopes(['scripts/native-workbench-frame-patch-extra.mjs']), ['web=false', 'desktop=true'])
})


test('README, bilingual record and release note changes skip Desktop packaging', () => {
  const paths = ['README.md', 'README.zh-CN.md', 'README.i18n.yaml', '.github/release-notes/desktop-v3.0.0-alpha.1.md']
  for (const path of paths) assert.deepEqual(scopes([path]), ['web=false', 'desktop=false'])
  assert.deepEqual(scopes(paths), ['web=false', 'desktop=false'])
  assert.deepEqual(scopes(['apps/desktop/README.md', 'apps/desktop/README.i18n.yaml']), ['web=false', 'desktop=false'])
  assert.deepEqual(scopes(['README.md', 'scripts/native-workbench-frame-patch.mjs']), ['web=true', 'desktop=true'])
})

test('tag and manual runs still force Desktop release checks', () => {
  const start = workflow.indexOf('          if [[ "$EVENT_NAME" == "workflow_dispatch"')
  const end = workflow.indexOf('          echo "product=$product"', start)
  assert.ok(start >= 0 && end > start)
  const classify = workflow.slice(start, end)
  for (const event of [{ EVENT_NAME: 'workflow_dispatch', REF_TYPE: 'branch' }, { EVENT_NAME: 'push', REF_TYPE: 'tag' }]) {
    const result = spawnSync('bash', ['-c', ['set -euo pipefail', classify,
      'printf "product=%s\\ndesktop=%s\\nweb=%s\\n" "$product" "$desktop" "$web"'].join('\n')], {
      cwd: root, env: { ...process.env, ...event, BASE_SHA: '', HEAD_SHA: '' }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'product=true\ndesktop=true\nweb=false\n')
  }
})
