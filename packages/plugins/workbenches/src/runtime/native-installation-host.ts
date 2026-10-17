import {InstalledWorkbenchManifestReader} from './installed-manifest-reader.js';
import {readWorkbenchSdkMetadata} from './sdk-metadata.js';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import { assertActorContext, type IdentityService, type WorkbenchDevelopment, type WorkbenchDescriptor } from 'workdsh-contracts';
import type { WorkbenchDevelopmentService } from './development-service.js';
import type { WorkbenchRequirementsService } from './requirements-service.js';
import type { WorkbenchInstallationArchives } from './installation-archives.js';
import { createProfileWorkbenchTarget } from './profile-target.js';
import { createNativeWorkbenchDevelopmentSessionVerifier } from './native-development-session.js';
import { readWorkbenchSourceCandidates } from './source-candidates.js';
import { receiveWorkbenchArtifact } from './upload-artifact.js';
import { inspectWorkbenchPackageArtifact } from './package-artifact.js';
import { validateWorkbenchPackageLayout } from './package-layout.js';
import { readWorkbenchRequestBody } from './request-body.js';

/** Reconcile a native package-manager installation. This owner never installs,
 * enables, reloads, or trusts a model-provided installation receipt. */
export async function mountNativeWorkbenchInstallationHost(ctx: Context, directory: string,
  development: WorkbenchDevelopmentService, requirements: WorkbenchRequirementsService,
  archives: WorkbenchInstallationArchives, isCompatible: (descriptor: WorkbenchDescriptor) => boolean,
  cordisVersion: string) {
  const identity = ctx.get('workdshIdentity') as IdentityService;
  const profile = ctx.get('profileContext') as ProfileContext;
  const connection = ctx.get('connection') as HostConnectionHandle;
  const resolveTarget = await createProfileWorkbenchTarget(ctx);
  const atomic = await import(pathToFileURL(createRequire(profile.installAnchor).resolve('@deepseek-ai/dsh-atomic-write')).href);
  let closed = false;
  ctx.effect(() => () => { closed = true; }, 'workdsh.workbench.native-installation.close');
  async function scope(developmentId: string | undefined, sessionId: string | undefined, signal?: AbortSignal) {
    const actor = await identity.resolve(sessionId ? { sessionId } : undefined, signal); assertActorContext(actor);
    const check = () => {
      signal?.throwIfAborted(); ctx.fiber.assertActive();
      const current = identity.profile();
      if (closed || current.principalId !== actor.principalId || current.organization.id !== actor.organizationId ||
        current.resolvedBy !== actor.resolvedBy || identity.membership(actor.organizationId, actor.principalId)?.state !== 'active')
        throw new Error('workbench/development-access-denied');
    };
    check(); const target = await resolveTarget(actor, signal); check();
    const entries = await development.list(signal); check();
    const matches = entries.filter(row => sessionId ? row.development.session?.sessionId === sessionId : row.development.id === developmentId);
    if (matches.length !== 1) throw new Error('workbench/development-owner-mismatch');
    const baseline = structuredClone(matches[0]!.development);
    if (!baseline.source || JSON.stringify(baseline.target) !== JSON.stringify(target)) throw new Error('workbench/installation-target-changed');
    const key = createHash('sha256').update(JSON.stringify([actor.organizationId, actor.principalId, target.hostId, baseline.id])).digest('hex');
    if (baseline.source.directory !== join(directory, 'workdsh-workbench-sources', key) || baseline.source.hostId !== target.hostId)
      throw new Error('workbench/source-identity-mismatch');
    const guard = async () => {
      check(); await resolveTarget(actor, signal); check();
      if (sessionId) { await createNativeWorkbenchDevelopmentSessionVerifier(ctx, sessionId)(actor, baseline, signal); check(); }
      const latest = (await requirements.history(baseline.id, signal)).at(-1); check();
      if (latest?.id !== baseline.requirementsRevision) throw new Error('workbench/requirements-revision-conflict');
      const current = (await development.list(signal)).find(row => row.development.id === baseline.id)?.development;
      check();
      if (current?.revision !== baseline.revision) throw new Error('workbench/development-revision-conflict');
    };
    await guard();
    return { baseline, target, check, guard };
  }
  async function candidates(baseline: WorkbenchDevelopment, harnessVersion: string, check: () => void, signal?: AbortSignal) {
    return readWorkbenchSourceCandidates(baseline.source!.directory, async (_name, bytes) => {
      const uploaded = await receiveWorkbenchArtifact(directory, new Response(bytes as BodyInit).body!, undefined, check, signal);
      if (uploaded.expected.packageName !== baseline.packageName || uploaded.expected.workbenchId !== baseline.workbenchId)
        throw new Error('workbench/package-identity-mismatch');
      const artifact = await inspectWorkbenchPackageArtifact(uploaded.path, uploaded.expected, signal);
      validateWorkbenchPackageLayout(artifact, { harnessVersion, cordisVersion }); check();
      return { package: artifact.receipt, descriptor: artifact.manifest.descriptor, compatible: isCompatible(artifact.manifest.descriptor) };
    }, check);
  }
  async function verify(developmentId: string | undefined, sessionId: string | undefined,
    input: { version: string; sha256: string }, expectedRevision?: string, signal?: AbortSignal) {
    if (!input.version?.trim() || input.version.length > 128 || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('workbench/invalid-request');
    const selected = { ...input };
    const { baseline, target, check, guard } = await scope(developmentId, sessionId, signal);
    if (expectedRevision !== undefined && expectedRevision !== baseline.revision) throw new Error('workbench/development-revision-conflict');
    const rows = await candidates(baseline, target.harnessVersion, check, signal); await guard();
    const candidate = rows.find(row => row.candidate?.package.version === selected.version && row.candidate.package.sha256 === selected.sha256)?.candidate;
    if (!candidate) {
      const rejected = rows.find(row => row.sha256 === selected.sha256 && row.errorCode);
      throw new Error(rejected?.errorCode ?? 'workbench/native-installation-candidate-missing');
    }
    if (!candidate.compatible) throw new Error('workbench/incompatible-package');
    let installed;
    try { installed = await new InstalledWorkbenchManifestReader(directory).read(baseline.packageName,signal); }
    catch(cause) { if(cause && typeof cause==='object' && 'code' in cause && cause.code==='ENOENT') throw Error('workbench/native-installation-not-present'); throw cause; }
    if(!installed) throw Error('workbench/native-installation-not-present');
    if(installed.descriptor.id!==baseline.workbenchId) throw Error('workbench/package-identity-mismatch');
    if(installed.version!==selected.version) throw Error('workbench/native-installation-version-different');
    const expected = { ...candidate.package, workbenchId: baseline.workbenchId };
    // Same public lock as the native installer: never record a mixed package generation.
    await atomic.withFileLock(join(directory, 'package.json'), async () => {
      await guard();
      try { await archives.retainVerified({ ...expected, path: join(directory, '.workdsh-workbench-archives', `${expected.sha256}.tgz`) }, check, signal); }
      catch(cause){if(cause&&typeof cause==='object'&&'code' in cause&&cause.code==='ENOENT')throw Error('workbench/installed-file-missing');throw cause;}
      await guard();
    }, { waitMs: 10_000 });
    await guard();
    return Object.freeze({ developmentId: baseline.id, iterationId: baseline.iterationId, package: candidate.package,
      descriptor: candidate.descriptor, installedVerified: true as const, activationVerified: false as const });
  }
  const api = {
    async readContext(sessionId: string, signal?: AbortSignal) {
      const { baseline, target, check, guard } = await scope(undefined, sessionId, signal);
      const revisions = await requirements.history(baseline.id, signal);
      const rows = await candidates(baseline, target.harnessVersion, check, signal);
      const sdk = await readWorkbenchSdkMetadata(profile.installAnchor); await guard();
      return { sdk, development: baseline, requirements: revisions.at(-1), harnessVersion: target.harnessVersion,
        cordisVersion, candidates: rows, installationProfile: target.profileId };
    },
    verifyNativeInstallation: (sessionId: string, input: { version: string; sha256: string }, signal?: AbortSignal) =>
      verify(undefined, sessionId, input, undefined, signal),
  };
  ctx.effect(() => connection.fetch.register({ path: '/api/workdsh-workbench-native-installation', methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        const value = await readWorkbenchRequestBody(request) as Record<string, unknown>;
        const keys = ['developmentId', 'expectedRevision', 'version', 'sha256'];
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
          !keys.every(key => typeof value[key] === 'string' && value[key].trim() && (value[key] as string).length <= 214)) throw new Error('workbench/invalid-request');
        const result = await verify(value.developmentId as string, undefined, { version: value.version as string, sha256: value.sha256 as string }, value.expectedRevision as string, request.signal);
        request.signal.throwIfAborted(); return Response.json({ ok: true, value: result });
      } catch (cause) {
        const code = cause instanceof Error && /^workbench\/[a-z-]+$/.test(cause.message) ? cause.message : 'workbench/native-installation-unconfirmed';
        return Response.json({ ok: false, error: { code } }, { status: request.signal.aborted ? 408 : code === 'workbench/invalid-request' ? 400 : ['workbench/development-owner-mismatch', 'workbench/development-access-denied'].includes(code) ? 403 : 409 });
      }
    } }), 'workdsh.workbench.native-installation.rpc');
  return api;
}
