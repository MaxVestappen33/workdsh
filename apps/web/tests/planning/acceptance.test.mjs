import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validateAcceptance } from '../../scripts/validate-acceptance.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
import { fileURLToPath } from 'node:url';
function fixture(mutate) {
  const path = mkdtempSync(resolve(tmpdir(), 'workdsh-acceptance-'));
  try {
    cpSync(resolve(root, 'docs'), resolve(path, 'docs'), { recursive: true });
    const file = resolve(path, 'docs/acceptance.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    mutate(data);
    writeFileSync(file, JSON.stringify(data));
    return validateAcceptance(path).failures;
  } finally { rmSync(path, { recursive: true, force: true }); }
}
test('every scenario has a valid single phase', () => {
  assert.deepEqual(validateAcceptance(root).failures, []);
  assert.ok(fixture(d => { d.cases[0].phase = 'P1/P3'; }).some(s => s.includes('Invalid single phase')));
});
test('a scenario cannot disappear or claim success without evidence', () => {
  assert.ok(fixture(d => { d.cases.pop(); }).some(s => s.includes('Unmapped acceptance')));
  assert.ok(fixture(d => { d.cases[0].status = 'passed'; }).some(s => s.includes('Passed without evidence')));
});

test('scenarios must retain their declared product requirement mapping', () => {
  assert.ok(fixture(d => { d.cases[0].requirements = ['R99']; }).some(s => s.includes('Unknown requirement')));
  assert.ok(fixture(d => { d.cases[0].requirements = ['R04']; }).some(s => s.includes('Missing reverse acceptance mapping')));
});

test('a product specification or path traversal cannot count as acceptance output', () => {
  for (const path of ['docs/ACCEPTANCE.md', '.artifacts/../docs/ACCEPTANCE.md']) {
    assert.ok(fixture(d => {
      d.cases[0].status = 'passed';
      d.cases[0].evidence = [path];
    }).some(s => s.includes('Invalid evidence path')));
  }
});

test('the finite roster includes execution, Office and enterprise adapter scenarios', () => {
  const { cases, failures } = validateAcceptance(root);
  assert.deepEqual(failures, []);
  for (const id of ['EC07', 'O03', 'H01', 'E01', 'E05', 'A20-P3']) {
    assert.ok(cases.some(item => item.id === id), id);
  }
});
