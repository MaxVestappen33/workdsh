import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { officialWebClients, parseOfficialPatch, patchSemantics, root } from '../../scripts/official-web-clients.mjs';

const canonical = await officialWebClients();
test('locked complete official Web roster includes dual-face APIs and retains published conditions', () => {
  for (const name of ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-workspace-files', '@deepseek-ai/dsh-cordis-client-runner', '@deepseek-ai/dsh-session-log-export']) {
    assert.ok(canonical.clients.some(client => client.package === name), name);
  }
  for (const id of ['product-analytics', 'ui-sidebar-browser']) {
    const client = canonical.clients.find(client => client.id === id);
    assert.equal(client.node.get('disabled', true).tag, 'tag:yaml.org,2002:js');
    assert.match(client.row.disabled, /profileContext/);
  }
});

test('derived roster exactly matches the same locked official package declarations', async () => {
  const roster = JSON.parse(await readFile(join(root, 'profiles/shared/official-web-clients.json'), 'utf8'));
  assert.equal(roster.dshVersion, canonical.version);
  assert.deepEqual(roster.sources, canonical.sources);
  assert.deepEqual(roster.officialClients.map(({ id, package: name, version, source, row, client, conditional }) => ({ id, package: name, version, source, row, client, conditional })),
    canonical.clients.map(({ id, package: name, version, source, row, declaration, conditional }) => ({ id, package: name, version, source, row, client: declaration, conditional })));
});

test('condition comparisons detect lost official JS tags', () => {
  const source = '- insert:\n    - id: conditional\n      name: official-client\n      disabled: !!js "profileContext.platform !== \'desktop\'"\n';
  const original = parseOfficialPatch(source), changed = parseOfficialPatch(source.replace('disabled: !!js', 'disabled:'));
  assert.deepEqual(original.toJSON(), changed.toJSON());
  assert.notDeepEqual(patchSemantics(original), patchSemantics(changed));
});
