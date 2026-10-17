import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWorkbenchDescriptor, parseWorkbenchDescriptor, workbenchActivationState, parseWorkbenchRequirementsDraft } from '../dist/workbenches.js';

const descriptor = () => ({ id: 'techflag.quality-analysis', title: '质量分析', description: '检验与缺陷分析', protocolVersion: '1.0', layout: 'full-page', hostCompatibility: { sdk: '^1.0.0', harness: '0.2.1-rc.1' }, capabilities: ['library.read', 'ai.draft'] });
test('requirement baseline is bounded, complete, immutable and excludes unrelated fields', () => {
  const input = { title: ' 质量分析 ', scenario: '质量问题', users: '质量工程师', dataSources: '企业接口待验证', workflow: '导入、分析、报告', firstIteration: 'CSV分析', acceptance: '样例结果能复算', token: 'must-not-persist' };
  const baseline = parseWorkbenchRequirementsDraft(input);
  assert.equal(baseline.title, '质量分析');
  assert.equal(baseline.dataSources, '企业接口待验证');
  assert.equal('token' in baseline, false);
  input.acceptance = 'changed';
  assert.equal(baseline.acceptance, '样例结果能复算');
  assert.throws(() => { baseline.title = 'changed'; }, TypeError);
  for (const patch of [{ acceptance: ' ' }, { title: 'a'.repeat(81) }, { workflow: 'a'.repeat(8001) }, { users: undefined }]) assert.throws(() => parseWorkbenchRequirementsDraft({ ...input, ...patch }), /invalid-requirements/);
});

test('installation and live registration must agree before reporting enabled or disabled', () => {
  const installed = { packageName: 'quality-workbench', version: '1.0.0', sha256: 'a'.repeat(64) };
  const facts = { installed, enabled: true, compatible: true };
  assert.equal(workbenchActivationState(facts), 'pending-restart');
  assert.equal(workbenchActivationState({ ...facts, active: installed }), 'enabled');
  assert.equal(workbenchActivationState({ ...facts, active: { ...installed, sha256: 'b'.repeat(64) } }), 'pending-restart');
  assert.equal(workbenchActivationState({ ...facts, enabled: false, active: installed }), 'pending-restart');
  assert.equal(workbenchActivationState({ ...facts, enabled: false }), 'disabled');
  assert.equal(workbenchActivationState({ ...facts, compatible: false, active: installed }), 'incompatible');
  assert.equal(workbenchActivationState({ ...facts, activationError: 'registration-conflict' }), 'failed');
  assert.throws(() => workbenchActivationState({ ...facts, installed: { ...installed, sha256: 'not-a-hash' } }), /invalid-package-receipt/);
});

test('local workbenches require neither a repository nor a project', () => {
  assert.doesNotThrow(() => assertWorkbenchDescriptor(descriptor()));
  assert.doesNotThrow(() => assertWorkbenchDescriptor({ ...descriptor(), repository: 'https://github.com/techflag/workdsh' }));
});
test('registration snapshot cannot be changed by the caller or retain unrelated fields', () => {
  const input = { ...descriptor(), token: 'must-not-be-retained', packageName: 'spoofed-owner' };
  const snapshot = parseWorkbenchDescriptor(input);
  input.id = 'other.workbench';
  input.capabilities.push('library.write');
  input.hostCompatibility.harness = '*';
  assert.equal(snapshot.id, 'techflag.quality-analysis');
  assert.deepEqual(snapshot.capabilities, ['library.read', 'ai.draft']);
  assert.equal(snapshot.hostCompatibility.harness, '0.2.1-rc.1');
  assert.equal('token' in snapshot, false);
  assert.equal('packageName' in snapshot, false);
  assert.throws(() => snapshot.capabilities.push('library.write'), TypeError);
  assert.throws(() => { snapshot.id = 'other.workbench'; }, TypeError);
});
test('reject incompatible registrations and undeclared or duplicate capabilities', () => {
  for (const [patch, code] of [
    [{ id: '../quality' }, 'invalid-id'],
    [{ protocolVersion: '2.0' }, 'incompatible-protocol'],
    [{ layout: 'iframe' }, 'unsupported-layout'],
    [{ capabilities: ['enterprise.token'] }, 'invalid-capabilities'],
    [{ capabilities: ['library.read', 'library.read'] }, 'invalid-capabilities'],
    [{ hostCompatibility: {} }, 'invalid-compatibility'],
  ]) assert.throws(() => assertWorkbenchDescriptor({ ...descriptor(), ...patch }), new RegExp(`workbench/${code}`));
});
test('repository metadata must not carry credentials or executable URLs', () => {
  for (const repository of ['https://user:secret@example.com/repo', 'javascript:alert(1)', 'file:///tmp/repo', 'not-a-url']) {
    assert.throws(() => assertWorkbenchDescriptor({ ...descriptor(), repository }), /workbench\/invalid-repository/);
  }
});
