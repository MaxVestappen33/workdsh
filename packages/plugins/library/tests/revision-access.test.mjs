import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import { LibraryManager } from '../dist/index.js';

const actor = { principalId: 'member.a', organizationId: 'org-a', requestId: 'revision-access', resolvedBy: 'test' };
const bytes = text => new TextEncoder().encode(text);

async function withLibrary(work) {
  const root = await mkdtemp(join(tmpdir(), 'workdsh-revision-access-'));
  const ctx = new Context();
  try {
    await ctx.plugin(Storage);
    await ctx.plugin(JsonStorage, { root: join(root, 'storage') });
    await ctx.plugin(StorageDomain, { backend: 'json' });
    await ctx.plugin(LibraryManager, { root: join(root, 'library') });
    await work(ctx.workdshLibrary);
  } finally {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

test('original, derived text and draft creation reject another asset revision, including a disabled asset', () => withLibrary(async library => {
  const first = await library.importAsset(actor, { name: 'first.txt', bytes: bytes('first original'), operationId: 'first' });
  const second = await library.importAsset(actor, { name: 'second.txt', bytes: bytes('second original'), operationId: 'second' });
  for (const status of ['active', 'disabled']) {
    await library.setAssetStatus(actor, second.asset.id, status);
    await assert.rejects(library.readOriginal(actor, first.asset.id, second.revision.id), /library\/revision-asset-mismatch/);
    await assert.rejects(library.readText(actor, first.asset.id, second.revision.id), /library\/revision-asset-mismatch/);
    await assert.rejects(library.createDraft(actor, first.asset.id, second.revision.id), /library\/revision-asset-mismatch/);
  }
  assert.deepEqual(await library.readOriginal(actor, first.asset.id, first.revision.id), bytes('first original'));
  await assert.rejects(library.readOriginal(actor, second.asset.id, second.revision.id), /library\/disabled/);
}));

test('valid historical revisions remain readable after publishing, with other owners isolated', () => withLibrary(async library => {
  const original = await library.importAsset(actor, { name: 'history.txt', bytes: bytes('version one'), operationId: 'history' });
  const draft = await library.createDraft(actor, original.asset.id, original.revision.id);
  const edited = await library.updateDraft(actor, draft.id, 'version two', draft.revision);
  const published = await library.publishDraft(actor, edited.id, edited.revision);
  assert.notEqual(published.revision.id, original.revision.id);
  assert.deepEqual(await library.readOriginal(actor, original.asset.id, original.revision.id), bytes('version one'));
  assert.deepEqual(await library.readOriginal(actor, original.asset.id), bytes('version two'));
  await assert.rejects(library.readOriginal({ ...actor, principalId: 'other-member' }, original.asset.id, original.revision.id), /library\/not-found/);
  await assert.rejects(library.readOriginal({ ...actor, organizationId: 'other-org' }, original.asset.id, original.revision.id), /library\/not-found/);
}));

test('legacy sanitized storage-key collisions cannot grant access to another owner', () => withLibrary(async library => {
  const asset = await library.importAsset(actor, { name: 'private.txt', bytes: bytes('private original'), operationId: 'private' });
  const collision = { ...actor, principalId: 'member-a' };
  await assert.rejects(library.space(collision), /library\/owner-mismatch/);
  await assert.rejects(library.readOriginal(collision, asset.asset.id, asset.revision.id), /library\/owner-mismatch/);
  await assert.rejects(library.importAsset(collision, { name: 'overwrite.txt', bytes: bytes('wrong owner'), operationId: 'overwrite' }), /library\/owner-mismatch/);
  assert.deepEqual(await library.readOriginal(actor, asset.asset.id), bytes('private original'));
}));

test('native original path resolves the exact historical bytes and rejects disabled or foreign revisions', () => withLibrary(async library => {
 const first=await library.importAsset(actor,{name:'source.csv',bytes:bytes('日期,数量\n2026-10-01,500'),operationId:'native-first'});
 const second=await library.importAsset(actor,{name:'other.csv',bytes:bytes('日期,数量\n2026-10-02,100'),operationId:'native-second'});
 const path=await library.originalFilePath(actor,first.asset.id,first.revision.id);
 assert.deepEqual(new Uint8Array(await readFile(path)),bytes('日期,数量\n2026-10-01,500'));
 await assert.rejects(library.originalFilePath(actor,first.asset.id,second.revision.id),/revision-asset-mismatch/);
 await assert.rejects(library.originalFilePath({...actor,principalId:'other-member'},first.asset.id,first.revision.id),/not-found/);
 await library.setAssetStatus(actor,first.asset.id,'disabled');
 await assert.rejects(library.originalFilePath(actor,first.asset.id,first.revision.id),/disabled/);
}));
