import { expect, it } from 'vitest'
import { createRuntimeOutputRedactor, redactRuntimeOutput, runtimeFailureDetail, runtimeFailureLog, officialCommandFailureDetail } from '../src/runtime-diagnostics.ts'

it('keeps startup cause when descendant cleanup also fails', () => {
  const detail = runtimeFailureDetail(false, 1, 'stderr: missing plugin entry', true)
  expect(detail).toContain('未能完成启动 (1)')
  expect(detail).toContain('missing plugin entry')
  expect(detail).toContain('停止尚未确认')
})
it('never emits credentials split at any child-process chunk boundary', () => {
  const raw = '就绪 http://localhost/?token=sensitive-token&api_key=hidden-key Bearer private-token sk-testsecret\n';
  const bytes = Buffer.from(raw);
  for (let split = 1; split < bytes.length; split++) {
    let output = '';
    const stream = createRuntimeOutputRedactor(text => { output += text });
    stream.push(bytes.subarray(0, split));
    expect(output).toBe('');
    stream.push(bytes.subarray(split)); stream.end();
    expect(output).toBe(redactRuntimeOutput(raw));
  }
})
it('bounds incomplete lines, discards oversized content and flushes a final safe line', () => {
  let output = '';
  const stream = createRuntimeOutputRedactor(text => { output += text });
  stream.push(Buffer.from('token=' + 'x'.repeat(20_000)));
  stream.push(Buffer.from('\n诊断信息'));
  stream.end();
  expect(output).toBe('[runtime output line omitted: size limit]\n诊断信息');
})
it('redacts credentials and bounds GUI diagnostics', () => {
  const raw = 'http://localhost/?token=secret&api_key=hidden Bearer private sk-testsecret {"bootstrapToken":"sensitive"}'
  const safe = redactRuntimeOutput(raw)
  for (const value of ['secret', 'hidden', 'private', 'sk-testsecret', 'sensitive']) expect(safe).not.toContain(value)
  expect(runtimeFailureDetail(false, 1, 'x'.repeat(20000)).length).toBeLessThan(700)
})

it('summarizes simultaneous startup causes while retaining the redacted trace in the log', () => {
  const raw = `Error: listen EADDRINUSE: address already in use 127.0.0.1:3080\n${'    at file:///long/runtime/stack.js:10:1\n'.repeat(150)}Error: Cannot find module '@deepseek-ai/dsh-atomic-write'\nBearer sensitive-test-value`;
  const detail = runtimeFailureDetail(false, 1, raw);
  expect(detail).toContain('3080');
  expect(detail).toContain('@deepseek-ai/dsh-atomic-write');
  expect(detail).not.toContain('stack.js');
  expect(detail.length).toBeLessThan(400);
  const log = runtimeFailureLog(false, 1, raw);
  expect(log).toContain('stack.js');
  expect(log).not.toContain('sensitive-test-value');
  expect(log).toContain('[redacted]');
})

it('explains an official compatibility rejection without suggesting a network failure or version bypass', () => {
  const detail = officialCommandFailureDetail(1, 'dsh: installation rejected: Plugin sigmapad-plugin@0.1.0-alpha.180 is incompatible with dsh 0.2.1-rc.1: requirements {"sdk":"0.2.0-rc.2"}. To accept this risk use allow-version\ndsh: restored package.json, pnpm-lock.yaml, and node_modules.\ndsh: plugin command failed; diagnostics: /local/log')
  expect(detail).toContain('sigmapad-plugin@0.1.0-alpha.180')
  expect(detail).toContain('DSH 0.2.1-rc.1 不兼容')
  expect(detail).toContain('已恢复')
  expect(detail).not.toMatch(/网络|allow-version/)
})
