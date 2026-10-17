import { expect, it } from 'vitest'
import { createRuntimeOutputRedactor, redactRuntimeOutput, runtimeFailureDetail } from '../src/runtime-diagnostics.ts'

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
  expect(runtimeFailureDetail(false, 1, 'x'.repeat(20000)).length).toBeLessThan(4200)
})
