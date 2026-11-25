import { expect, it } from 'vitest'
import { createRuntimeOutputRedactor, isHandleExhaustion, isStackOverflow, planRuntimeRestart, RUNTIME_RESTART_LIMIT, RUNTIME_RESTART_STABLE_MS, redactRuntimeOutput, retryStartupAfterHandleExhaustion, runtimeCrashDetail, runtimeCrashLog, runtimeCrashLogName, runtimeFailureDetail, runtimeFailureLog, shouldRetryStartup, startupFailureLogName, officialCommandFailureDetail } from '../src/runtime-diagnostics.ts'

const EMFILE_OUTPUT = "dsh: fatal uncaught exception: StartupError: 1 required plugin did not activate\nError: EMFILE: too many open files, open 'C:\\Users\\u\\AppData\\Roaming\\PoliceAssistant\\dsh-home\\.credentials.yaml'"

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

it('retries a handle-exhausted first start once and recovers when the retry becomes ready', async () => {
  let starts = 0
  const lines: string[] = []
  const outcome = await retryStartupAfterHandleExhaustion(EMFILE_OUTPUT, 0, async () => { starts += 1 }, { delayMs: 0, log: line => lines.push(line) })
  expect(outcome).toBe('retried')
  expect(starts).toBe(1)
  expect(lines.join('\n')).toContain('首次启动因句柄耗尽失败')
  // 重试成功后不会再走到失败分支的 report，因此也没有第二次启动决定。
  expect(shouldRetryStartup('', 1)).toBe(false)
})

it('stops after the retried start also fails, so the second failure reaches the error dialog', async () => {
  let retries = 0
  const retry = async (): Promise<void> => { retries += 1 }
  expect(await retryStartupAfterHandleExhaustion(EMFILE_OUTPUT, 0, retry, { delayMs: 0 })).toBe('retried')
  expect(await retryStartupAfterHandleExhaustion(EMFILE_OUTPUT, 1, retry, { delayMs: 0 })).toBe('stop')
  expect(retries).toBe(1)
})

it('never retries a startup failure that is not handle exhaustion', async () => {
  let retries = 0
  const retry = async (): Promise<void> => { retries += 1 }
  for (const output of ['', 'Error: listen EADDRINUSE: address already in use 127.0.0.1:3080', 'Cannot find module "@deepseek-ai/dsh-atomic-write"']) {
    expect(await retryStartupAfterHandleExhaustion(output, 0, retry, { delayMs: 0 })).toBe('stop')
  }
  expect(retries).toBe(0)
  expect(isHandleExhaustion('Error: ENFILE: system file table overflow')).toBe(true)
  expect(isHandleExhaustion(EMFILE_OUTPUT)).toBe(true)
})

it('keeps the first failure and the retry result in separate records', () => {
  const now = new Date(2026, 10, 25, 21, 29, 3, 120)
  expect(startupFailureLogName(0, now)).toBe('runtime-failure-20261125-212903-120.log')
  expect(startupFailureLogName(1, now)).toBe('runtime-failure-retry-20261125-212903-120-1.log')
  expect(runtimeFailureLog(false, 1, EMFILE_OUTPUT)).toContain('[首次启动]')
  expect(runtimeFailureLog(false, 1, EMFILE_OUTPUT, false, 1)).toContain('[第 2 次启动（句柄耗尽后重试）]')
  expect(runtimeFailureLog(false, 1, EMFILE_OUTPUT, false, 1)).toContain('EMFILE')
})

const STACK_OUTPUT = `[workdsh:probe] activated
dsh web: http://127.0.0.1:3080/?token=[redacted]
dsh: fatal load failure: RangeError: Maximum call stack size exceeded
    at Reflect.set (<anonymous>)
    at Object.set (file:///C:/Users/u/AppData/Local/Programs/PoliceAssistant/resources/workdsh-runtime/profiles/workdsh/node_modules/@deepseek-ai/cordis/lib/index.js:151:19)`

it('records a running-time crash separately from startup failures', () => {
  const now = new Date(2026, 10, 25, 21, 28, 30, 45)
  expect(runtimeCrashLogName(2, now)).toBe('runtime-failure-crash-20261125-212830-045-2.log')
  const log = runtimeCrashLog(1, STACK_OUTPUT, 2, 2, RUNTIME_RESTART_LIMIT)
  expect(log).toContain('[运行中异常退出]')
  expect(log).toContain('本机第 2 份崩溃记录')
  expect(log).toContain('官方 DSH 进程已退出 (1)')
  expect(log).toContain('自动重启：第 2 / 3 次')
  // 现场证据必须原样留在本机记录里，弹窗才做归纳。
  expect(log).toContain('cordis/lib/index.js:151')
  expect(log).not.toContain('token=secret')
})

it('explains a stack overflow instead of blaming the installation', () => {
  expect(isStackOverflow(STACK_OUTPUT)).toBe(true)
  expect(isStackOverflow(EMFILE_OUTPUT)).toBe(false)
  const detail = runtimeCrashDetail(1, STACK_OUTPUT, 'C:/logs/runtime-failure-crash-1.log')
  expect(detail).toContain('已退出 (1)')
  expect(detail).toContain('调用栈溢出')
  expect(detail).toContain('runtime-failure-crash-1.log')
  // 非栈溢出的崩溃不多说一句，避免把用户引到错误的处置方向。
  expect(runtimeCrashDetail(1, 'Error: boom')).not.toContain('调用栈溢出')
})

it('restarts a crashed host within budget and gives up after repeated failures', () => {
  expect(planRuntimeRestart(30_000, 0)).toEqual({ restart: 1, delayMs: 1_500 })
  expect(planRuntimeRestart(30_000, 1)).toEqual({ restart: 2, delayMs: 3_000 })
  expect(planRuntimeRestart(30_000, 2)).toEqual({ restart: 3, delayMs: 6_000 })
  expect(planRuntimeRestart(30_000, 3)).toBe('give-up')
  // 稳定运行过一段时间的进程只算一次意外：预算清零，长运行现场可以反复自愈。
  expect(planRuntimeRestart(RUNTIME_RESTART_STABLE_MS, 3)).toEqual({ restart: 1, delayMs: 1_500 })
  // 连续崩溃不会无限等待：延迟封顶在最后一个档位。
  expect(planRuntimeRestart(0, 2, { limit: 9, delaysMs: [10, 20] })).toEqual({ restart: 3, delayMs: 20 })
})
