import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  AUDIT_AGGREGATE_WINDOW_MS,
  AUDIT_FLUSH_INTERVAL_MS,
  AUDIT_SPOOL_MAX,
  AUDIT_SPOOL_MAX_REPLAY,
  GateAuditRecorder,
} from '../dist/index.js';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const denied = (reasonCode = 'gate/denied-not-entitled') => ({ layer: 'call_tool', reasonCode });
const spoolPath = dir => join(dir, 'audit-spool.jsonl');
const tempDir = () => mkdtemp(join(tmpdir(), 'gate-audit-'));
const acceptedAll = (events) => ({ accepted: events.length });

test('闸门关闭：不入队、不启动定时器、不读也不写 spool', async () => {
  const dir = await tempDir();
  const warned = [];
  const sent = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { sent.push(events); return acceptedAll(events); },
    warn: message => warned.push(message),
    clientVersion: '1.4.2',
  });
  try {
    // 未 start（等价于关闸）：判定路径入队为空操作。
    recorder.recordDenied(denied());
    recorder.recordWrite({ action: 'install', assetType: 'skill', assetId: 'a', succeeded: true });
    await recorder.flush();
    assert.equal(sent.length, 0);

    // start 后立即 stop（开闸又关闸）：清掉队列与定时器。
    recorder.start();
    recorder.stop();
    recorder.recordDenied(denied());
    await wait(AUDIT_FLUSH_INTERVAL_MS + 200);
    assert.equal(sent.length, 0);

    // 关闸不读 spool：预置的 spool 内容保持不变。
    const pending = { eventId: 'spool-1', eventType: 'denied', layer: 'call_tool', reasonCode: 'x', resultCode: 'denied', clientTime: '2026-11-09 09:58:12' };
    await writeFile(spoolPath(dir), JSON.stringify(pending), 'utf8');
    await recorder.flush();
    assert.match(await readFile(spoolPath(dir), 'utf8'), /spool-1/u);
    assert.equal(warned.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('accepted 与 duplicated 都删除；单批带上 clientVersion 和 UUID 事件号', async () => {
  const dir = await tempDir();
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    clientVersion: '1.4.2',
    send: async events => {
      batches.push(events);
      return { accepted: events.length };
    },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    recorder.recordWrite({ action: 'uninstall', assetType: 'mcp', assetId: 'b', succeeded: true });
    await recorder.flush();
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 2);
    for (const event of batches[0]) {
      assert.match(event.eventId, /^[0-9a-f-]{36}$/u);
      assert.equal(event.clientVersion, '1.4.2');
      assert.match(event.clientTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    }
    // 已全部确认：队列清空，再 flush 不再发。
    await recorder.flush();
    assert.equal(batches.length, 1);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('duplicated（幂等命中）同样删除，不重试', async () => {
  const dir = await tempDir();
  let calls = 0;
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { calls += 1; return { duplicated: events.length, duplicateEventIds: events.map(event => event.eventId) }; },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    await recorder.flush();
    await recorder.flush();
    assert.equal(calls, 1);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('failed 保留重试：下一批只重发未入库的事件', async () => {
  const dir = await tempDir();
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => {
      batches.push(events);
      if (batches.length === 1) {
        assert.equal(events.length, 2);
        return {
          duplicated: 1,
          duplicateEventIds: [events[0].eventId],
          failed: 1,
          failedEventIds: [events[1].eventId],
        };
      }
      return acceptedAll(events);
    },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    recorder.recordDenied(denied('gate/denied-not-listed'));
    await recorder.flush();
    await recorder.flush();
    assert.equal(batches.length, 2);
    assert.equal(batches[1].length, 1);
    assert.equal(batches[1][0].eventId, batches[0][1].eventId);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid 丢弃并告警（含 eventId 与原因），不再重试', async () => {
  const dir = await tempDir();
  const warned = [];
  let calls = 0;
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => {
      calls += 1;
      return { invalidEvents: events.map(event => ({ eventId: event.eventId, reason: 'assetType 非法' })) };
    },
    warn: message => warned.push(message),
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    await recorder.flush();
    await recorder.flush();
    assert.equal(calls, 1);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /eventId=/u);
    assert.match(warned[0], /assetType 非法/u);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('整单失败：本批写入 spool，重启后补发并清空', async () => {
  const dir = await tempDir();
  const failing = new GateAuditRecorder({
    spoolDir: dir,
    send: async () => { throw new Error('network down'); },
    warn: () => {},
  });
  try {
    failing.start();
    failing.recordDenied(denied());
    failing.recordWrite({ action: 'enable', assetType: 'skill', assetId: 's', succeeded: false });
    await failing.flush();
    const lines = (await readFile(spoolPath(dir), 'utf8')).split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  } finally {
    failing.stop();
  }

  const batches = [];
  const replay = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: () => {},
  });
  try {
    replay.start();
    await replay.flush();
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 2);
    assert.equal((await readFile(spoolPath(dir), 'utf8')).trim(), '');
  } finally {
    replay.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('spool 超过上限丢最旧并告警；补发只发保留的部分', async () => {
  const dir = await tempDir();
  const extra = 10;
  const rows = Array.from({ length: AUDIT_SPOOL_MAX + extra }, (_, index) => JSON.stringify({
    eventId: `event-${index}`,
    eventType: 'denied',
    layer: 'call_tool',
    reasonCode: 'gate/denied-not-entitled',
    resultCode: 'denied',
    clientTime: '2026-11-09 09:58:12',
  }));
  await writeFile(spoolPath(dir), rows.join('\n'), 'utf8');
  const warned = [];
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: message => warned.push(message),
  });
  try {
    recorder.start();
    assert.equal(warned.length, 1);
    assert.match(warned[0], new RegExp(`丢弃最旧 ${extra} 条`, 'u'));
    // 单批上限 100：500 条分 5 批发完。
    for (let index = 0; index < AUDIT_SPOOL_MAX / 100; index += 1) await recorder.flush();
    assert.equal(batches.flat().length, AUDIT_SPOOL_MAX);
    assert.equal(batches[0][0].eventId, `event-${extra}`);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('攒够 20 条自动触发一次发送（无需显式 flush）', async () => {
  const dir = await tempDir();
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: () => {},
  });
  try {
    recorder.start();
    // 用不同资产编号避免被 60 秒聚合合并成一条。
    for (let index = 0; index < 20; index += 1) recorder.recordDenied({ ...denied(), assetType: 'mcp', assetId: `mcp-${index}` });
    await wait(50);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 20);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('3 秒定时器触发：单条事件也会在间隔后发送', async () => {
  const dir = await tempDir();
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    await wait(AUDIT_FLUSH_INTERVAL_MS + 300);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 1);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('单飞：请求在飞时新的 flush 复用同一个 Promise', async () => {
  const dir = await tempDir();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { calls += 1; await gate; return acceptedAll(events); },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    const first = recorder.flush();
    const second = recorder.flush();
    assert.equal(first, second);
    recorder.recordDenied(denied());
    release();
    await first;
    assert.equal(calls, 1);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('60 秒聚合：同键窗口内累加 repeatCount 并保留首条时间，窗口外另起一条', async () => {
  const dir = await tempDir();
  let clock = new Date(2026, 10, 9, 9, 58, 12).getTime();
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    now: () => clock,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: () => {},
  });
  const event = { layer: 'call_tool', reasonCode: 'gate/denied-not-entitled', assetType: 'mcp', assetId: 'mcp-1' };
  try {
    recorder.start();
    recorder.recordDenied(event);
    clock += 30_000;
    recorder.recordDenied(event);
    clock += 1_000;
    recorder.recordDenied(event);
    await recorder.flush();

    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 1);
    assert.equal(batches[0][0].repeatCount, 3);
    assert.equal(batches[0][0].clientTime, '2026-11-09 09:58:12');

    // 首条在前 61 秒：窗口已过，另起新条目（仍在同一批队列里）。
    clock += 30_000;
    recorder.recordDenied(event);
    await recorder.flush();
    assert.equal(batches.length, 2);
    assert.equal(batches[1].length, 1);
    assert.equal(batches[1][0].repeatCount, 1);
    assert.notEqual(batches[1][0].eventId, batches[0][0].eventId);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('已进入发送批次的事件不再参与聚合：窗口内也会另起一条', async () => {
  const dir = await tempDir();
  let clock = new Date(2026, 10, 9, 9, 58, 12).getTime();
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    now: () => clock,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: () => {},
  });
  const event = { layer: 'call_tool', reasonCode: 'gate/denied-not-entitled', assetType: 'mcp', assetId: 'mcp-1' };
  try {
    recorder.start();
    recorder.recordDenied(event);
    await recorder.flush();
    assert.equal(batches[0][0].repeatCount, 1);

    // 仍在 60 秒窗口内，但首条已发出：只能新增一条，不能回改后台已入库的计数。
    clock += 5_000;
    recorder.recordDenied(event);
    await recorder.flush();
    assert.equal(batches.length, 2);
    assert.equal(batches[1][0].repeatCount, 1);
    assert.notEqual(batches[1][0].eventId, batches[0][0].eventId);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('不同原因码或不同层不合并', async () => {
  const dir = await tempDir();
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied({ layer: 'call_tool', reasonCode: 'gate/denied-not-entitled', assetType: 'mcp', assetId: 'mcp-1' });
    recorder.recordDenied({ layer: 'call_tool', reasonCode: 'gate/denied-snapshot-stale', assetType: 'mcp', assetId: 'mcp-1' });
    recorder.recordDenied({ layer: 'data_layer', reasonCode: 'gate/denied-not-entitled', assetType: 'mcp', assetId: 'mcp-1', action: 'enable' });
    await recorder.flush();
    assert.equal(batches[0].length, 3);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('撤权自动恢复：revocation 层 write/success，带 auto-restored 标识', async () => {
  const dir = await tempDir();
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordWrite({
      layer: 'revocation',
      action: 'restore',
      assetType: 'skill',
      assetId: 'asset-1',
      succeeded: true,
      remark: 'auto-restored',
    });
    await recorder.flush();
    const event = batches[0][0];
    assert.equal(event.eventType, 'write');
    assert.equal(event.layer, 'revocation');
    assert.equal(event.action, 'restore');
    assert.equal(event.resultCode, 'success');
    assert.equal(event.remark, 'auto-restored');
    assert.equal(event.repeatCount, 1);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('聚合窗口常量与需求一致（60 秒）', () => {
  assert.equal(AUDIT_AGGREGATE_WINDOW_MS, 60_000);
});

test('数字回执：accepted 是条数也不抛错，duplicated 命中即清理不重发', async () => {
  const dir = await tempDir();
  let calls = 0;
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => {
      calls += 1;
      // 与后台真实回执一致：三个计数字段都是数字，明细只有 duplicateEventIds。
      return { accepted: 0, duplicated: events.length, failed: 0, duplicateEventIds: events.map(event => event.eventId) };
    },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    recorder.recordDenied(denied('gate/denied-not-listed'));
    await recorder.flush();
    await recorder.flush();
    assert.equal(calls, 1);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('只回计数、不回 id 明细：没有任何失败迹象即整批终结', async () => {
  const dir = await tempDir();
  let calls = 0;
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { calls += 1; return { accepted: events.length, duplicated: 0, failed: 0 }; },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    recorder.recordDenied(denied('gate/denied-not-listed'));
    await recorder.flush();
    await recorder.flush();
    assert.equal(calls, 1);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('回执解析异常：本批按终结丢弃，不回队重复上报', async () => {
  const dir = await tempDir();
  let calls = 0;
  const warned = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async () => {
      calls += 1;
      // 回执结构异常：读取 accepted 时抛错（不带 then，避免被 await 提前判为 reject）。
      return { get accepted() { throw new Error('boom'); } };
    },
    warn: message => warned.push(message),
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    await recorder.flush();
    await recorder.flush();
    assert.equal(calls, 1);
    assert.match(warned.join('\n'), /已丢弃本批 1 条/u);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('spool 补发超过上限：丢弃并告警，不再发送', async () => {
  const dir = await tempDir();
  const rows = Array.from({ length: 3 }, (_, index) => JSON.stringify({
    eventId: `event-${index}`,
    eventType: 'denied',
    layer: 'call_tool',
    reasonCode: 'gate/denied-not-entitled',
    resultCode: 'denied',
    clientTime: '2026-11-09 09:58:12',
    repeatCount: 1,
    spoolAttempts: AUDIT_SPOOL_MAX_REPLAY,
  }));
  await writeFile(spoolPath(dir), rows.join('\n'), 'utf8');
  const warned = [];
  const batches = [];
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { batches.push(events); return acceptedAll(events); },
    warn: message => warned.push(message),
  });
  try {
    recorder.start();
    await recorder.flush();
    assert.equal(batches.length, 0);
    assert.match(warned.join('\n'), new RegExp(`已补发 ${AUDIT_SPOOL_MAX_REPLAY} 次仍未成功，已丢弃`, 'u'));
    assert.equal((await readFile(spoolPath(dir), 'utf8')).trim(), '');
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('请求体只含纯事件结构：不发送 attempted / spoolAttempts', async () => {
  const dir = await tempDir();
  let captured;
  const recorder = new GateAuditRecorder({
    spoolDir: dir,
    send: async events => { captured = events; return acceptedAll(events); },
    warn: () => {},
  });
  try {
    recorder.start();
    recorder.recordDenied(denied());
    await recorder.flush();
    assert.equal(captured.length, 1);
    assert.equal('attempted' in captured[0], false);
    assert.equal('spoolAttempts' in captured[0], false);
    assert.equal(captured[0].eventType, 'denied');
    assert.match(captured[0].eventId, /^[0-9a-f-]{36}$/u);
  } finally {
    recorder.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
