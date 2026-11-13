import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { zipStream } from '../dist/zip.js';

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('文本与二进制条目按序写入同一个 ZIP', async () => {
  const entries = (async function* () {
    yield { path: 'manifest.json', content: '{"schema":1}' };
    yield { path: 'diagnostics/logs/a.log', content: 'hello' };
    yield { path: 'media/x.bin', data: new Uint8Array([1, 2, 3]) };
  })();
  const buffer = await collect(zipStream(entries));
  const files = unzipSync(new Uint8Array(buffer));
  assert.deepEqual(Object.keys(files), ['manifest.json', 'diagnostics/logs/a.log', 'media/x.bin']);
  assert.equal(strFromU8(files['manifest.json']), '{"schema":1}');
  assert.equal(strFromU8(files['diagnostics/logs/a.log']), 'hello');
  assert.deepEqual([...files['media/x.bin']], [1, 2, 3]);
});

test('分块流条目按原顺序拼接', async () => {
  const chunks = (async function* () {
    yield new Uint8Array([65]);
    yield new Uint8Array([66, 67]);
    yield new Uint8Array([]);
  })();
  const buffer = await collect(zipStream((async function* () {
    yield { path: 'files/chunked.txt', chunks };
  })()));
  const files = unzipSync(new Uint8Array(buffer));
  assert.equal(strFromU8(files['files/chunked.txt']), 'ABC');
});

test('空条目集合产出合法空 ZIP', async () => {
  const buffer = await collect(zipStream((async function* () {})()));
  assert.deepEqual(Object.keys(unzipSync(new Uint8Array(buffer))), []);
});
