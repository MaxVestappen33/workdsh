#!/usr/bin/env node
/**
 * 从后台导出内置技能的签名 envelope，供构建期写入内置清单。
 *
 * 用法：
 *   node scripts/export-builtin-skill-signatures.mjs \
 *     --ids "1857:weather,1858:news" \
 *     [--out packages/plugins/skills/builtin-signatures] \
 *     [--base http://127.0.0.1:18080/ytsj-ai] \
 *     [--token <X-Access-Token>]
 *
 * `--ids` 接受 `assetId:技能名` 逗号分隔列表；技能名必须与随包内置的技能目录名一致，
 * 导出文件按 `<技能名>.json` 落盘，构建脚本据此匹配。
 *
 * 环境变量：WORKDSH_ADMIN_BASE（默认 http://127.0.0.1:18080/ytsj-ai）、
 * WORKDSH_ADMIN_TOKEN（与 --token 等价）。
 *
 * 输出即后台返回的 envelope 原样（assetType/assetId/payloadVersion/algo/keyId/digest/
 * signature/fileCount/files/signedAt），不做任何字段改写。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'plugins', 'skills', 'builtin-signatures');
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/export-builtin-skill-signatures.mjs --ids "1857:weather,1858:news" [--out <dir>] [--base <url>] [--token <token>]');
  process.exit(2);
}

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, base: process.env.WORKDSH_ADMIN_BASE ?? 'http://127.0.0.1:18080/ytsj-ai', token: process.env.WORKDSH_ADMIN_TOKEN };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ids' || arg === '--out' || arg === '--base' || arg === '--token') {
      const value = argv[index + 1];
      if (!value) usage(`${arg} 需要一个值`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    usage(`未知参数：${arg}`);
  }
  return options;
}

function parseIds(value) {
  if (!value) usage('缺少 --ids');
  const pairs = value.split(',').map(item => item.trim()).filter(Boolean).map(item => {
    const index = item.indexOf(':');
    if (index <= 0 || index === item.length - 1) usage(`--ids 条目格式应为 assetId:技能名：${item}`);
    const assetId = item.slice(0, index).trim();
    const name = item.slice(index + 1).trim();
    if (!assetId) usage(`assetId 为空：${item}`);
    if (!NAME_PATTERN.test(name)) usage(`技能名只能包含字母、数字、点、下划线与短横线：${name}`);
    return { assetId, name };
  });
  const names = new Set(pairs.map(pair => pair.name));
  if (names.size !== pairs.length) usage('--ids 中技能名重复');
  return pairs;
}

async function fetchEnvelope(base, token, assetId) {
  const url = new URL(`${base.replace(/\/+$/, '')}/desktop-client/asset/queryAssetSignature`);
  url.searchParams.set('assetType', 'skill');
  url.searchParams.set('assetId', assetId);
  const headers = { Accept: 'application/json' };
  if (token) headers['X-Access-Token'] = token;
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch {
    throw new Error(`${url} 返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
  }
  if (!response.ok || body?.success === false) {
    throw new Error(`${url} 调用失败（HTTP ${response.status}）：${body?.message ?? text.slice(0, 200)}`);
  }
  const envelope = body?.result;
  if (!envelope || typeof envelope !== 'object') throw new Error(`${url} 响应缺少 result`);
  if (String(envelope.assetId) !== String(assetId)) {
    throw new Error(`${url} 返回的 assetId=${envelope.assetId} 与请求 ${assetId} 不一致`);
  }
  return envelope;
}

const options = parseArgs(process.argv.slice(2));
const pairs = parseIds(options.ids);
const out = resolve(options.out);
await mkdir(out, { recursive: true });

let failed = 0;
for (const pair of pairs) {
  try {
    const envelope = await fetchEnvelope(options.base, options.token, pair.assetId);
    const target = join(out, `${pair.name}.json`);
    await writeFile(target, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    console.log(`exported: assetId=${pair.assetId} name=${pair.name} -> ${target}`);
  } catch (error) {
    failed += 1;
    console.error(`failed: assetId=${pair.assetId} name=${pair.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failed) {
  console.error(`${failed}/${pairs.length} 个签名导出失败；构建期 strict 模式会因此中断，请补齐后再打包。`);
  process.exit(1);
}
