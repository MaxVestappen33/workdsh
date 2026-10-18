import { workbenchActivationState, type WorkbenchPackageReceipt, type WorkbenchDescriptor, parseWorkbenchDescriptor } from 'workdsh-contracts';
import { WorkbenchRegistry, type WorkbenchRegistrationAuthority } from './registry.js';
import { resolveWorkbenchLoaderSource, type WorkbenchCallerContext, type WorkbenchLoader } from './loader-source.js';
import type { WorkbenchManifestReader } from './catalog.js';

export interface VerifiedWorkbenchInstallation {
  readonly package: WorkbenchPackageReceipt;
  readonly compatible: boolean;
  readonly descriptor: WorkbenchDescriptor;
}
/** Host-owned verifier must obtain receipt hashes from actual verified installation facts. */
export type VerifyWorkbenchInstallation = (packageName: string, version: string, signal?: AbortSignal) => Promise<VerifiedWorkbenchInstallation>;

export class HostWorkbenchRegistration<Page> {
  private closed = false;
  private readonly callers = new Map<string, { caller: WorkbenchCallerContext; generation: symbol }>();
  private readonly disposers = new Set<() => void>();
  private readonly authorities = new WeakMap<object, WorkbenchRegistrationAuthority>();
  private readonly registry = new WorkbenchRegistry<Page>(caller => this.authorities.get(caller));
  constructor(private readonly loader: WorkbenchLoader, private readonly reader: WorkbenchManifestReader, private readonly verifyInstallation: VerifyWorkbenchInstallation) {}

  async register(caller: WorkbenchCallerContext, declaration: unknown, page: Page, signal?: AbortSignal): Promise<() => void> {
    this.assertOpen();
    signal?.throwIfAborted();
    const source = resolveWorkbenchLoaderSource(this.loader, caller);
    const manifest = await this.reader.read(source.packageName, signal);
    if (!manifest) throw new Error('workbench/missing-static-declaration');
    const verified = await this.verifyInstallation(source.packageName, manifest.version, signal);
    signal?.throwIfAborted();
    this.assertOpen();
    const currentSource = resolveWorkbenchLoaderSource(this.loader, caller);
    if (source.entryId !== currentSource.entryId || source.moduleName !== currentSource.moduleName) throw new Error('workbench/caller-source-changed');
    if (verified.package.packageName !== manifest.packageName || verified.package.version !== manifest.version) throw new Error('workbench/installation-changed');
    const canonical = (value: WorkbenchDescriptor) => JSON.stringify({ ...parseWorkbenchDescriptor(value), capabilities: [...value.capabilities].sort() });
    if (canonical(verified.descriptor) !== canonical(manifest.descriptor)) throw new Error('workbench/installation-declaration-changed');
    // Validate real receipt shape; this does not manufacture an artifact hash from metadata.
    workbenchActivationState({ installed: verified.package, enabled: true, compatible: verified.compatible });
    this.authorities.set(caller, { descriptor: manifest.descriptor, package: verified.package, enabled: true, compatible: verified.compatible });
    try {
      const release = this.registry.register(caller, declaration, page);
      const binding = { caller, generation: Symbol(manifest.descriptor.id) };
      this.callers.set(manifest.descriptor.id, binding);
      const dispose = () => {release();if(this.callers.get(manifest.descriptor.id)===binding)this.callers.delete(manifest.descriptor.id);this.disposers.delete(dispose);};
      this.disposers.add(dispose);return dispose;
    }
    finally { this.authorities.delete(caller); }
  }

  /** Read-only Client facts. Caller package still must be derived independently
   * from the Client Loader; these facts do not grant domain permissions. */
  async clientAuthority(packageName: string, signal?: AbortSignal): Promise<WorkbenchRegistrationAuthority> {
    this.assertOpen(); signal?.throwIfAborted();
    const entry = this.registry.list().find(row => row.package.packageName === packageName);
    const binding = entry && this.callers.get(entry.descriptor.id);
    if (!entry || !binding) throw new Error('workbench/unregistered-package');
    const source = resolveWorkbenchLoaderSource(this.loader, binding.caller);
    if (source.packageName !== packageName) throw new Error('workbench/caller-source-changed');
    const manifest = await this.reader.read(packageName, signal);
    if (!manifest) throw new Error('workbench/missing-static-declaration');
    const verified = await this.verifyInstallation(packageName, manifest.version, signal);
    signal?.throwIfAborted(); this.assertOpen();
    const current = resolveWorkbenchLoaderSource(this.loader, binding.caller);
    if (this.callers.get(entry.descriptor.id) !== binding || current.entryId !== source.entryId || current.moduleName !== source.moduleName)
      throw new Error('workbench/caller-source-changed');
    const canonical = (value: WorkbenchDescriptor) => JSON.stringify({ ...parseWorkbenchDescriptor(value), capabilities: [...value.capabilities].sort() });
    if (verified.package.packageName !== packageName || verified.package.version !== entry.package.version ||
        verified.package.sha256 !== entry.package.sha256 || manifest.version !== entry.package.version)
      throw new Error('workbench/installation-changed');
    if (canonical(manifest.descriptor) !== canonical(entry.descriptor) || canonical(verified.descriptor) !== canonical(entry.descriptor))
      throw new Error('workbench/installation-declaration-changed');
    if (!verified.compatible) throw new Error('workbench/incompatible-host');
    return Object.freeze({ descriptor: parseWorkbenchDescriptor(entry.descriptor), package: Object.freeze({ ...verified.package }), enabled: true, compatible: true });
  }

  list() { this.assertOpen(); return this.registry.list(); }
  close() {if(this.closed)return;this.closed=true;for(const dispose of this.disposers)dispose();}
  private assertOpen() {if(this.closed)throw new Error('workbench/registration-service-closed');}

  /** Public lifecycle adapter must use this method rather than retaining an unmanaged registration. */
  async registerManaged(caller: WorkbenchCallerContext & { effect(body: () => (() => void), label?: string): () => void | Promise<void> }, declaration: unknown, page: Page, signal?: AbortSignal): Promise<() => void | Promise<void>> {
    const dispose = await this.register(caller, declaration, page, signal);
    try { return caller.effect(() => dispose, 'workdsh.workbench.registration'); }
    catch (cause) { dispose(); throw cause; }
  }
}
