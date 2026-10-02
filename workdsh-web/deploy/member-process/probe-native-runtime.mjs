import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

// Explicit headless Linux test only; do not invoke from production startup.
const profile=process.argv[2] ?? '/opt/workdsh/profiles/enterprise';
const expectedUid=Number(process.argv[3]);
assert.equal(process.platform,'linux','Native member probe requires Linux');
assert.ok(isAbsolute(profile),'An absolute current immutable Profile path is required');
assert.ok(Number.isSafeInteger(expectedUid) && expectedUid>0,'Explicit non-root member UID required');
assert.equal(process.getuid(),expectedUid);
const require = createRequire(join(profile,'package.json'));
const { Context } = await import(require.resolve('@deepseek-ai/cordis'));
const { default: LocalSubprocessRuntime } = await import(require.resolve('@deepseek-ai/dsh-subprocess-local'));
const context = new Context();
const previousCanary=process.env.PERSONAL_CANARY_API_KEY;
process.env.PERSONAL_CANARY_API_KEY = 'synthetic-canary';
const fixture=await mkdtemp(join(tmpdir(),'workdsh-member-native-'));
await writeFile(join(fixture,'data'), 'own-data', { mode: 0o600 });
let terminal;
let fiber;
const timer = setTimeout(() => { console.error('Native runtime probe timed out'); process.exit(1); }, 20_000);
try {
  fiber = context.plugin(LocalSubprocessRuntime);
  await fiber.await();
  const handle = context.subprocess.spawn({ argv: [process.execPath, '-e',
    "const a=require('node:assert/strict');a.equal(process.env.PERSONAL_CANARY_API_KEY,undefined);a.equal(require('node:fs').readFileSync('./data','utf8'),'own-data');process.stdout.write('OWN_PROCESS_OK')"],
    cwd: fixture, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 500 });
  let output = '';
  handle.stdout.on('data', data => { output += data; });
  assert.equal((await handle.done).exitCode, 0);
  assert.equal(output, 'OWN_PROCESS_OK');
  assert.equal(await handle.waitForExit(AbortSignal.timeout(3_000)), true);
  terminal = await context.subprocess.spawnTerminal({ argv: ['/bin/sh', '-c', 'printf OWN_TERMINAL_OK'],
    cwd: fixture, rows: 24, cols: 80, terminalType: 'xterm', graceMs: 500 });
  let ttyOutput = '';
  terminal.output.on('data', data => { ttyOutput += data; });
  assert.equal((await terminal.done).exitCode, 0);
  assert.ok(ttyOutput.includes('OWN_TERMINAL_OK'));
  await terminal.terminate();
  const koffi = require('koffi');
  assert.equal(koffi.load('libc.so.6').func('int getuid()')(), expectedUid);
  console.log(JSON.stringify({ officialSubprocess: true, terminal: true, childSecretScrub: true,
    nativeFfi: true, nonRoot: true, uid:expectedUid, modelCalls: 0 }));
} finally {
  clearTimeout(timer);
  await terminal?.terminate();
  await fiber?.dispose();
  if(previousCanary===undefined)delete process.env.PERSONAL_CANARY_API_KEY;
  else process.env.PERSONAL_CANARY_API_KEY=previousCanary;
  await rm(fixture,{recursive:true,force:true});
}
