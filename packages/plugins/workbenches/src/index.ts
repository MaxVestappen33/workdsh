import {mountWorkbenchDevelopmentTimingHost} from './runtime/development-timing-host.js';
import {mountWorkbenchAcceptanceHost} from './runtime/acceptance-host.js';
import { createRequire } from 'node:module';
import type { Context } from '@deepseek-ai/cordis';
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';
import { mountWorkbenchRegistrationHost } from './runtime/registration-host.js';
import { mountWorkbenchCatalogHost } from './runtime/catalog-host.js';
import { mountWorkbenchActivationHost } from './runtime/activation-host.js';
import { mountProfileWorkbenchImportHost } from './runtime/profile-import-host.js';
import { mountProfileWorkbenchAuthoringHost } from './runtime/profile-authoring-host.js';
import { mountNativeWorkbenchInstallationHost } from './runtime/native-installation-host.js';
import { registerWorkbenchDevelopmentTools } from './runtime/development-tools.js';
import {mountWorkbenchCreationHost} from './runtime/creation-host.js';
import {mountWorkbenchShortcutsHost} from './runtime/shortcuts-host.js';

const semver=createRequire(import.meta.url)('semver') as {
  satisfies(version:string,range:string,options:{includePrerelease:boolean}):boolean;
};
export const name='workdsh-workbenches';
export const inject=['profileContext','loader','storageDomain','connection','workdshIdentity','workdshAccess','sessionController','workspaceController','tools'];
export async function apply(ctx:Context) {
  const kernel=getDshRuntimeVersion();
  const isCompatible = (descriptor: import('workdsh-contracts').WorkbenchDescriptor) =>
    semver.satisfies('1.0.0',descriptor.hostCompatibility.sdk,{includePrerelease:true}) &&
    semver.satisfies(kernel,descriptor.hostCompatibility.harness,{includePrerelease:true});
  const registration = await mountWorkbenchRegistrationHost<string>(ctx,isCompatible);
  mountWorkbenchShortcutsHost(ctx,id=>registration.registration.list().some(row=>row.descriptor.id===id));
  ctx.fiber.assertActive();
  const authoring = await mountProfileWorkbenchAuthoringHost(ctx);
  await mountWorkbenchCreationHost(ctx,authoring);
  const cordisVersion = createRequire(import.meta.url)('@deepseek-ai/cordis/package.json').version as string;
  const imports = await mountProfileWorkbenchImportHost(ctx,authoring.development,isCompatible,cordisVersion,registration.archives);
  const nativeInstallation = await mountNativeWorkbenchInstallationHost(ctx,registration.directory,authoring.development,authoring.requirements,registration.archives,isCompatible,cordisVersion);
  await mountWorkbenchAcceptanceHost(ctx,authoring.development,authoring.requirements,registration.directory,registration.archives,registration.registration,isCompatible);
  registerWorkbenchDevelopmentTools(ctx,await mountWorkbenchDevelopmentTimingHost(ctx,registration.directory,authoring.development,authoring.requirements,nativeInstallation));
  await mountWorkbenchActivationHost(ctx,registration.directory,registration.archives,authoring.development,isCompatible,imports.verifyOfflineAssociation);
  await mountWorkbenchCatalogHost(ctx,registration.directory,registration.archives,registration.registration,isCompatible);
}

export type { HostWorkbenchRegistration } from './runtime/host-registration.js';

/** Public authoring types; owned contracts are bundled into the platform archive. */
export type { WorkbenchDescriptor, WorkbenchPackageReceipt, WorkbenchRequirementsDraft, WorkbenchRequirementsRevision, WorkbenchDevelopmentIndexEntry } from 'workdsh-contracts';
export type { WorkbenchSystemDefinition, WorkbenchSystemModule } from 'workdsh-contracts';
