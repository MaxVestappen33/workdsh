import assert from 'node:assert/strict';
import test from 'node:test';
import { auditDefaultPluginDelivery, readOwnedManifests, assertDefaultOwnedClosure } from '../../scripts/check-plugin-delivery.mjs';

test('personal default source package closure excludes independently installed enterprise plugins', async () => {
  const proof = await auditDefaultPluginDelivery();
  assert.equal(proof.externalEnterprisePackagesAbsent, true);
  for (const name of ['workdsh-provider-identity-enterprise', 'workdsh-plugin-enterprise-collaboration']) {
    assert.ok(!proof.ownedClosure.includes(name), name);
  }
});

test('default delivery rejects external feature peers and build dependencies', async () => {
  const originals = await readOwnedManifests();
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const name of ['workdsh-provider-identity-enterprise', 'workdsh-plugin-enterprise-collaboration']) {
      const manifests = structuredClone(originals);
      const row = manifests.get('workdsh-plugin-access');
      row.manifest[field] = { ...row.manifest[field], [name]: '0.1.0-alpha.1' };
      assert.throws(() => assertDefaultOwnedClosure(manifests), /Default package closure contains an external feature/);
    }
  }
});

test('reviewed build-only reuse never becomes a runtime or foreign dependency', async () => {
  const originals = await readOwnedManifests();
  // 只有登记过的那条边（library 的 devDependency）可以复用 office。
  const other = structuredClone(originals);
  const consumer = other.get('workdsh-plugin-access');
  consumer.manifest.devDependencies = { ...consumer.manifest.devDependencies, 'workdsh-plugin-office': 'workspace:*' };
  assert.throws(() => assertDefaultOwnedClosure(other), /Default package closure contains an external feature/);
  // 同一功能一旦进入运行期字段，即使来源是登记的消费方也必须失败。
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const manifests = structuredClone(originals);
    const row = manifests.get('workdsh-plugin-library');
    row.manifest[field] = { ...row.manifest[field], 'workdsh-plugin-office': 'workspace:*' };
    assert.throws(() => assertDefaultOwnedClosure(manifests), /Default package closure contains an external feature/);
  }
});
