import { openWorkbenchImportAssociations } from './import-associations.js';
import { receiveWorkbenchArtifact } from './upload-artifact.js';
import { readWorkbenchSourceCandidates } from './source-candidates.js';
import { inspectWorkbenchPackageArtifact } from './package-artifact.js';
import { validateWorkbenchPackageLayout } from './package-layout.js';
import { prepareWorkbenchImport } from './prepare-import.js';
import { readWorkbenchRequestBody } from './request-body.js';
import { handleWorkbenchImportRequest, workbenchImportPath, type WorkbenchImportRequest } from './import-rpc.js';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { handleWorkbenchUploadRequest, workbenchUploadPath } from './upload-rpc.js';
import type { Context } from '@deepseek-ai/cordis';
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot';
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { assertActorContext, type IdentityService, type WorkbenchDescriptor } from 'workdsh-contracts';
import { WorkbenchDevelopmentOperations, type WorkbenchOperationIntent } from './development-operations.js';
import { WorkbenchOperationRunner } from './operation-runner.js';
import { createProfileWorkbenchInstaller } from './profile-installer.js';
import { createProfileWorkbenchTarget } from './profile-target.js';
import { createWorkbenchImportOperationAdapter } from './import-operation.js';
import type { WorkbenchInstallationArchives } from './installation-archives.js';
import type { WorkbenchDevelopmentService } from './development-service.js';

/** Internal Host service. Paths are trusted owner inputs, never an RPC payload.
 * Uses the registration owner's archives and one journal per member/development. */
export async function mountProfileWorkbenchImportHost(ctx: Context, development: WorkbenchDevelopmentService,
  isCompatible: (descriptor: WorkbenchDescriptor) => boolean, cordisVersion: string, archives: WorkbenchInstallationArchives) {
  const identity = ctx.get('workdshIdentity') as IdentityService;
  const storage = ctx.get('storageDomain') as DomainFacility;
  const profile = ctx.get('profileContext') as ProfileContext;
  if (!identity || !storage || !archives || !profile) throw new Error('workbench/host-services-unavailable');
  const capturedProfile = { name: profile.name, dir: profile.dir };
  const directory = await realpath(capturedProfile.dir), resolveTarget = await createProfileWorkbenchTarget(ctx);
  const journals = new Map<string, Promise<WorkbenchDevelopmentOperations>>();
  const associations = new Map<string, ReturnType<typeof openWorkbenchImportAssociations>>();
  async function importAssociations(actor: Parameters<typeof openWorkbenchImportAssociations>[1]) {
    const key = JSON.stringify([actor.organizationId, actor.principalId]);
    let pending = associations.get(key);
    if (!pending) { pending = openWorkbenchImportAssociations(storage, actor); associations.set(key, pending);
      pending.catch(() => { if (associations.get(key) === pending) associations.delete(key); }); }
    return pending;
  }
  async function ownsImport(id: string, actor: Parameters<typeof openWorkbenchImportAssociations>[1], target: unknown, expected?: {workbenchId:string;packageName:string}) {
    if (!id.startsWith('import:')) return false;
    const row = (await importAssociations(actor)).list().find(row => `import:${row.id}` === id);
    return !!row && JSON.stringify(row.target) === JSON.stringify(target) && (!expected || row.workbenchId === expected.workbenchId && row.packageName === expected.packageName);
  }
  let closed = false;
  const service = {
    async verifyOfflineAssociation(actor: Parameters<typeof openWorkbenchImportAssociations>[1], id:string, expected:{packageName:string;workbenchId:string}, signal?:AbortSignal) {
      const check=()=>{signal?.throwIfAborted();ctx.fiber.assertActive();const current=identity.profile();
        if(closed||current.principalId!==actor.principalId||current.organization.id!==actor.organizationId||current.resolvedBy!==actor.resolvedBy||identity.membership(actor.organizationId,actor.principalId)?.state!=='active')throw new Error('workbench/development-access-denied');};
      check();const target=await resolveTarget(actor,signal);check();const owned=await ownsImport(id,actor,target,expected);check();return owned;
    },
    async list(developmentId: string, signal?: AbortSignal) {
      const actor = await identity.resolve(undefined, signal); assertActorContext(actor);
      const authorize = () => {
        signal?.throwIfAborted(); ctx.fiber.assertActive();
        const current = identity.profile();
        if (closed || current.principalId !== actor.principalId || current.organization.id !== actor.organizationId || current.resolvedBy !== actor.resolvedBy ||
            identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('workbench/development-access-denied');
      };
      authorize();
      const entries = await development.list(signal); authorize();
      const target = await resolveTarget(actor, signal); authorize();
      if (!entries.some(row => row.development.id === developmentId) && !await ownsImport(developmentId, actor, target)) throw new Error('workbench/development-owner-mismatch');
      authorize();
      const key = JSON.stringify([actor.organizationId, actor.principalId, developmentId]);
      let pending = journals.get(key);
      if (!pending) {
        pending = WorkbenchDevelopmentOperations.open(storage, actor, developmentId); journals.set(key, pending);
        pending.catch(() => { if (journals.get(key) === pending) journals.delete(key); });
      }
      const journal = await pending; authorize();
      return journal.list().filter(row => ['install', 'update'].includes(row.kind) && JSON.stringify(row.target) === JSON.stringify(target)).map(row => Object.freeze({
        id: row.id, iterationId: row.iterationId, developmentId: row.developmentId, state: row.state, kind: row.kind,
        inputHash: row.inputHash, candidate: row.candidate, expectedInstalledHash: row.expectedInstalledHash,
        receipt: row.receipt, errorCode: row.errorCode, revision: row.revision, updatedAt: row.updatedAt,
      }));
    },
    async run(input: {
      developmentId: string; intent: WorkbenchOperationIntent;
      expected: { packageName: string; version: string; workbenchId: string; sha256: string };
      archivePath?: string; recover?: boolean;
    }, signal?: AbortSignal) {
      // Capture before any asynchronous work; later caller mutation cannot change installation facts.
      const request = structuredClone(input);
      signal?.throwIfAborted();
      const actor = await identity.resolve(undefined, signal); assertActorContext(actor);
      const authorize = () => {
        signal?.throwIfAborted(); ctx.fiber.assertActive();
        const current = identity.profile();
        if (closed || current.principalId !== actor.principalId || current.organization.id !== actor.organizationId ||
            current.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active')
          throw new Error('workbench/development-access-denied');
        const currentProfile = ctx.get('profileContext') as ProfileContext;
        if (currentProfile?.dir !== capturedProfile.dir || currentProfile.name !== capturedProfile.name) throw new Error('workbench/installation-target-changed');
      };
      authorize();
      const entries = await development.list(signal);
      authorize();
      const target = await resolveTarget(actor, signal); authorize();
      const owningDevelopment = entries.find(row => row.development.id === request.developmentId && row.development.workbenchId === request.expected.workbenchId && row.development.packageName === request.expected.packageName)?.development;
      if (!owningDevelopment &&
          !await ownsImport(request.developmentId, actor, target, request.expected)) throw new Error('workbench/development-owner-mismatch');
      authorize();
      if (JSON.stringify(request.intent.target) !== JSON.stringify(target)) throw new Error('workbench/installation-target-changed');
      // A new install belongs to the current saved requirements iteration. A
      // historical operation may still be reconciled without resubmitting it.
      if (!request.recover && owningDevelopment && owningDevelopment.iterationId !== request.intent.iterationId)
        throw new Error('workbench/operation-iteration-conflict');
      const checkDevelopmentBaseline = !request.recover && owningDevelopment ? async () => {
        authorize();
        const current = (await development.list(signal)).find(row => row.development.id === request.developmentId)?.development;
        authorize();
        if (!current || current.workbenchId !== request.expected.workbenchId || current.packageName !== request.expected.packageName ||
          current.iterationId !== owningDevelopment.iterationId || current.requirementsRevision !== owningDevelopment.requirementsRevision)
          throw new Error('workbench/operation-iteration-conflict');
        if (JSON.stringify(current.target) !== JSON.stringify(target)) throw new Error('workbench/installation-target-changed');
      } : undefined;
      await checkDevelopmentBaseline?.();
      const key = JSON.stringify([actor.organizationId, actor.principalId, request.developmentId]);
      let pending = journals.get(key);
      if (!pending) {
        pending = WorkbenchDevelopmentOperations.open(storage, actor, request.developmentId);
        journals.set(key, pending);
        pending.catch(() => { if (journals.get(key) === pending) journals.delete(key); });
      }
      const journal = await pending; authorize();
      const install = await createProfileWorkbenchInstaller(ctx, authorize); authorize();
      const adapter = createWorkbenchImportOperationAdapter({ installationRoot: directory,
        archivePath: request.recover ? join(directory, '.workdsh-workbench-archives', `${request.expected.sha256}.tgz`) : request.archivePath ?? '',
        expected: request.expected, target, host: { harnessVersion: target.harnessVersion, cordisVersion },
        archives, install, authorize, isCompatible, checkInstalledBaseline: checkDevelopmentBaseline });
      const runner = new WorkbenchOperationRunner(journal, adapter, operation => {
        authorize();
        if (operation.inputHash !== request.expected.sha256 || operation.iterationId !== request.intent.iterationId ||
            operation.kind !== request.intent.kind || operation.expectedInstalledHash !== request.intent.expectedInstalledHash ||
            JSON.stringify(operation.target) !== JSON.stringify(target) || (operation.receipt?.package &&
              (operation.receipt.package.packageName !== request.expected.packageName || operation.receipt.package.version !== request.expected.version)))
          throw new Error('workbench/operation-input-conflict');
      });
      if (request.recover) return runner.reconcile(request.intent.id, actor, signal);
      return runner.execute({ ...request.intent, candidate: request.expected }, actor, signal);
    },
  };
  ctx.effect(() => () => { closed = true; return Promise.allSettled([...journals.values(), ...associations.values()].map(async pending => (await pending).close())); }, 'workdsh.workbench.import.close');
  const connection = ctx.get('connection') as HostConnectionHandle | undefined;
  if (connection) ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-source-candidates', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        const input = await readWorkbenchRequestBody(request) as Record<string, unknown>;
        if (!input || Object.keys(input).length !== 1 || typeof input.developmentId !== 'string' || !input.developmentId.trim()) throw new Error('workbench/invalid-request');
        const actor = await identity.resolve(undefined, request.signal); assertActorContext(actor);
        const authorize = () => {
          request.signal.throwIfAborted(); ctx.fiber.assertActive(); const current = identity.profile();
          if (closed || current.principalId !== actor.principalId || current.organization.id !== actor.organizationId || current.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('workbench/development-access-denied');
        };
        authorize(); const target = await resolveTarget(actor, request.signal);
        const entry = (await development.list(request.signal)).find(row => row.development.id === input.developmentId);
        authorize();
        if (!entry) throw new Error('workbench/development-not-found');
        if (JSON.stringify(entry.development.target) !== JSON.stringify(target)) throw new Error('workbench/installation-target-changed');
        if (!entry.development.source) throw new Error('workbench/development-source-unavailable');
        const expected = entry.development;
        const rows = await readWorkbenchSourceCandidates(expected.source!.directory, async (_name, bytes) => {
          const uploaded = await receiveWorkbenchArtifact(directory, new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), undefined, authorize, request.signal);
          if (uploaded.expected.packageName !== expected.packageName || uploaded.expected.workbenchId !== expected.workbenchId) throw new Error('workbench/package-identity-mismatch');
          const artifact = await inspectWorkbenchPackageArtifact(uploaded.path, uploaded.expected, request.signal);
          validateWorkbenchPackageLayout(artifact, { harnessVersion: target.harnessVersion, cordisVersion });
          return { package: artifact.receipt, descriptor: artifact.manifest.descriptor, compatible: isCompatible(artifact.manifest.descriptor) };
        }, authorize);
        const current = (await development.list(request.signal)).find(row => row.development.id === expected.id);
        await resolveTarget(actor, request.signal); authorize();
        if (current?.development.revision !== expected.revision) throw new Error('workbench/development-revision-conflict');
        return Response.json({ ok: true, value: rows });
      } catch (cause) {
        const code = cause instanceof Error && /^workbench\/[a-z-]+$/.test(cause.message) ? cause.message : 'workbench/package-preview-failed';
        return Response.json({ ok: false, error: { code } }, { status: request.signal.aborted ? 408 : 409 });
      }
    } }), 'workdsh.workbench.source.candidates.rpc');
  if (connection) ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-offline-imports', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        const input = await readWorkbenchRequestBody(request);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('workbench/invalid-request');
        const actor = await identity.resolve(undefined, request.signal); assertActorContext(actor);
        const authorize = () => {
          request.signal.throwIfAborted();ctx.fiber.assertActive();const current=identity.profile();
          if (closed || current.principalId!==actor.principalId || current.organization.id!==actor.organizationId || current.resolvedBy!==actor.resolvedBy ||
              identity.membership(actor.organizationId,actor.principalId)?.state!=='active') throw new Error('workbench/development-access-denied');
        };
        authorize();const target=await resolveTarget(actor,request.signal);
        const store=await importAssociations(actor);authorize();
        const rows=store.list().filter(row=>JSON.stringify(row.target)===JSON.stringify(target)).map(row=>({importId:`import:${row.id}`,packageName:row.packageName,workbenchId:row.workbenchId,createdAt:row.createdAt}));
        await resolveTarget(actor,request.signal);authorize();return Response.json({ok:true,value:rows});
      } catch {return Response.json({ok:false,error:{code:'workbench/records-unavailable'}},{status:request.signal.aborted?408:403});}
    } }), 'workdsh.workbench.offline.list.rpc');
  if (connection) ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-offline-prepare', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        const value = await readWorkbenchRequestBody(request) as Record<string, unknown>;
        const keys = ['packageName','version','workbenchId','sha256'];
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
            !keys.every(key => typeof value[key] === 'string' && value[key].trim() && (value[key] as string).length <= 214) || !/^[a-f0-9]{64}$/.test(value.sha256 as string)) throw new Error('workbench/invalid-request');
        const actor = await identity.resolve(undefined, request.signal); assertActorContext(actor);
        const authorize = () => {
          request.signal.throwIfAborted(); ctx.fiber.assertActive(); const current = identity.profile();
          if (closed || current.principalId !== actor.principalId || current.organization.id !== actor.organizationId || current.resolvedBy !== actor.resolvedBy ||
              identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('workbench/development-access-denied');
        };
        authorize(); const target = await resolveTarget(actor, request.signal); authorize();
        const expected = {packageName:value.packageName as string,version:value.version as string,workbenchId:value.workbenchId as string,sha256:value.sha256 as string};
        const result = await prepareWorkbenchImport({installationRoot:directory, expected,
          host:{harnessVersion:target.harnessVersion,cordisVersion},archives,authorize,isCompatible},request.signal);
        const store = await importAssociations(actor); authorize();
        // Prefer existing authoring ownership; never create a second identity for that plugin.
        const entries = await development.list(request.signal); authorize();
        const existing = entries.find(row => row.development.workbenchId === expected.workbenchId || row.development.packageName === expected.packageName);
        if (existing && (existing.development.workbenchId !== expected.workbenchId || existing.development.packageName !== expected.packageName || JSON.stringify(existing.development.target) !== JSON.stringify(target))) throw new Error('workbench/import-association-conflict');
        await resolveTarget(actor, request.signal); authorize();
        const id = existing?.development.id ?? `import:${(await store.bind({workbenchId:expected.workbenchId,packageName:expected.packageName,target},authorize,request.signal)).id}`;
        authorize(); return Response.json({ok:true,value:{...result,importId:id}});
      } catch(cause) {
        const code = cause instanceof Error && /^workbench\/[a-z-]+$/.test(cause.message) ? cause.message : 'workbench/import-prepare-failed';
        return Response.json({ok:false,error:{code}},{status:request.signal.aborted ? 408 : code === 'workbench/development-access-denied' ? 403 : 409});
      }
    } }), 'workdsh.workbench.offline.prepare.rpc');
  if (connection) ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-package-preview', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        if (request.headers.get('content-type') !== 'application/octet-stream' || !request.body) return Response.json({ ok: false, error: { code: 'workbench/invalid-request' } }, { status: 400 });
        const actor = await identity.resolve(undefined, request.signal); assertActorContext(actor);
        const authorize = () => {
          request.signal.throwIfAborted(); ctx.fiber.assertActive(); const current = identity.profile();
          if (closed || current.principalId !== actor.principalId || current.organization.id !== actor.organizationId || current.resolvedBy !== actor.resolvedBy ||
              identity.membership(actor.organizationId, actor.principalId)?.state !== 'active') throw new Error('workbench/development-access-denied');
        };
        authorize(); const target = await resolveTarget(actor, request.signal);
        const uploaded = await receiveWorkbenchArtifact(directory, request.body, undefined, authorize, request.signal);
        const artifact = await inspectWorkbenchPackageArtifact(uploaded.path, uploaded.expected, request.signal);
        validateWorkbenchPackageLayout(artifact, { harnessVersion: target.harnessVersion, cordisVersion });
        await resolveTarget(actor, request.signal); authorize();
        return Response.json({ ok: true, value: { package: artifact.receipt, descriptor: artifact.manifest.descriptor, compatible: isCompatible(artifact.manifest.descriptor) } });
      } catch (cause) {
        const code = cause instanceof Error && /^workbench\/[a-z-]+$/.test(cause.message) ? cause.message : 'workbench/package-preview-failed';
        return Response.json({ ok: false, error: { code } }, { status: request.signal.aborted ? 408 : code === 'workbench/package-archive-size-limit' ? 413 : code === 'workbench/development-access-denied' ? 403 : 422 });
      }
    } }), 'workdsh.workbench.package.preview.rpc');
  if (connection) ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-import-records', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        const value = await readWorkbenchRequestBody(request) as Record<string, unknown>;
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.developmentId !== 'string' || !value.developmentId.trim() || value.developmentId.length > 128)
          return Response.json({ ok: false, error: { code: 'workbench/invalid-request' } }, { status: 400 });
        const records = await service.list(value.developmentId, request.signal);
        request.signal.throwIfAborted(); return Response.json({ ok: true, value: records });
      } catch { return Response.json({ ok: false, error: { code: 'workbench/records-unavailable' } }, { status: request.signal.aborted ? 408 : 403 }); }
    } }), 'workdsh.workbench.import.records.rpc');
  if (connection) ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-import-prepare', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        const value = await readWorkbenchRequestBody(request) as Record<string, unknown>;
        const keys = ['developmentId', 'packageName', 'version', 'workbenchId', 'sha256'];
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
            !keys.every(key => typeof value[key] === 'string' && value[key].trim() && (value[key] as string).length <= 214) || !/^[a-f0-9]{64}$/.test(value.sha256 as string))
          return Response.json({ ok: false, error: { code: 'workbench/invalid-request' } }, { status: 400 });
        const actor = await identity.resolve(undefined, request.signal); assertActorContext(actor);
        const authorize = () => {
          request.signal.throwIfAborted(); ctx.fiber.assertActive();
          const current = identity.profile();
          if (closed || current.principalId !== actor.principalId || current.organization.id !== actor.organizationId ||
              current.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active')
            throw new Error('workbench/development-access-denied');
        };
        authorize(); const target = await resolveTarget(actor, request.signal);
        const entries = await development.list(request.signal); authorize();
        if (!entries.some(row => row.development.id === value.developmentId && row.development.packageName === value.packageName && row.development.workbenchId === value.workbenchId))
          throw new Error('workbench/development-owner-mismatch');
        const result = await prepareWorkbenchImport({ installationRoot: directory,
          expected: { packageName: value.packageName as string, version: value.version as string, workbenchId: value.workbenchId as string, sha256: value.sha256 as string },
          host: { harnessVersion: target.harnessVersion, cordisVersion }, archives, authorize, isCompatible }, request.signal);
        await resolveTarget(actor, request.signal); authorize();
        return Response.json({ ok: true, value: result });
      } catch (cause) {
        const code = cause instanceof Error && /^workbench\/[a-z-]+$/.test(cause.message) ? cause.message : 'workbench/import-prepare-failed';
        return Response.json({ ok: false, error: { code } }, { status: request.signal.aborted ? 408 : ['workbench/development-access-denied', 'workbench/development-owner-mismatch'].includes(code) ? 403 : 409 });
      }
    } }), 'workdsh.workbench.import.prepare.rpc');
  if (connection) ctx.effect(() => connection.fetch.register({ path: workbenchImportPath, methods: ['POST'], requestBody: 'streaming',
    fetch: request => handleWorkbenchImportRequest(request, async (input: WorkbenchImportRequest, signal) => {
      const actor = await identity.resolve(undefined, signal); assertActorContext(actor);
      const target = await resolveTarget(actor, signal);
      const expected = { packageName: input.packageName, version: input.version, workbenchId: input.workbenchId, sha256: input.sha256 };
      const operation = await service.run({ developmentId: input.developmentId, expected,
        archivePath: join(directory, '.workdsh-workbench-archives', `${input.sha256}.tgz`), recover: input.recover,
        intent: { id: input.operationId, iterationId: input.iterationId, kind: input.kind, inputHash: input.sha256, target, expectedInstalledHash: input.expectedInstalledHash } }, signal);
      return { id: operation.id, developmentId: operation.developmentId, iterationId: operation.iterationId,
        state: operation.state, kind: operation.kind, inputHash: operation.inputHash, revision: operation.revision,
        receipt: operation.receipt, errorCode: operation.errorCode };
    }) }), 'workdsh.workbench.import.rpc');
  if (connection) ctx.effect(() => connection.fetch.register({ path: workbenchUploadPath, methods: ['POST'], requestBody: 'streaming',
    fetch: request => handleWorkbenchUploadRequest(request, directory, async (metadata, signal) => {
      const actor = await identity.resolve(undefined, signal); assertActorContext(actor);
      const authorize = () => {
        signal.throwIfAborted(); ctx.fiber.assertActive();
        const current = identity.profile();
        if (closed || current.principalId !== actor.principalId || current.organization.id !== actor.organizationId ||
            current.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active')
          throw new Error('workbench/development-access-denied');
        const currentProfile = ctx.get('profileContext') as ProfileContext;
        if (currentProfile?.dir !== capturedProfile.dir || currentProfile.name !== capturedProfile.name) throw new Error('workbench/installation-target-changed');
      };
      authorize();
      const entries = await development.list(signal); authorize();
      if (!entries.some(row => row.development.id === metadata.developmentId && row.development.packageName === metadata.packageName && row.development.workbenchId === metadata.workbenchId))
        throw new Error('workbench/development-owner-mismatch');
      return authorize;
    }) }), 'workdsh.workbench.upload.rpc');
  ctx.provide('workdshWorkbenchImport', service);
  return service;
}
