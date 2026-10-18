import { workbenchActivationState, type WorkbenchPackageReceipt, type WorkbenchDescriptor, parseWorkbenchDescriptor } from 'workdsh-contracts';
import { WorkbenchRegistry, type WorkbenchRegistrationAuthority } from './registry.js';
import { resolveWorkbenchLoaderSource, type WorkbenchCallerContext, type WorkbenchLoader, type WorkbenchLoaderSource } from './loader-source.js';
import type { WorkbenchManifestReader } from './catalog.js';

export interface VerifiedWorkbenchInstallation {
  readonly package: WorkbenchPackageReceipt;
  readonly compatible: boolean;
  readonly descriptor: WorkbenchDescriptor;
}
/** Host-owned verifier must obtain receipt hashes from actual verified installation facts. */
export type VerifyWorkbenchInstallation = (packageName: string, version: string, signal?: AbortSignal) => Promise<VerifiedWorkbenchInstallation>;

/** Only produced after caller, installed bytes and declaration have been checked.
 * Managed plugin activation can retain this rejected entry without failing boot. */
class IncompatibleWorkbenchRegistration extends Error {
  constructor(readonly installation: VerifiedWorkbenchInstallation, readonly source: WorkbenchLoaderSource) { super('workbench/incompatible-host'); }
}
interface WorkbenchBinding {
  readonly caller: WorkbenchCallerContext;
  readonly generation: symbol;
  readonly descriptor: WorkbenchDescriptor;
  readonly package: WorkbenchPackageReceipt;
  readonly compatible: boolean;
}

export class HostWorkbenchRegistration<Page> {
  private closed = false;
  private readonly callers = new Map<string, WorkbenchBinding>();
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
    if (canonical(parseWorkbenchDescriptor(declaration)) !== canonical(manifest.descriptor)) throw new Error('workbench/declaration-mismatch');
    // Validate real receipt shape; this does not manufacture an artifact hash from metadata.
    workbenchActivationState({ installed: verified.package, enabled: true, compatible: verified.compatible });
    if (this.callers.has(manifest.descriptor.id)) throw new Error('workbench/registration-conflict');
    if (!verified.compatible) throw new IncompatibleWorkbenchRegistration(Object.freeze({
      descriptor: parseWorkbenchDescriptor(manifest.descriptor), package: Object.freeze({ ...verified.package }), compatible: false,
    }), source);
    this.authorities.set(caller, { descriptor: manifest.descriptor, package: verified.package, enabled: true, compatible: verified.compatible });
    try {
      const release = this.registry.register(caller, declaration, page);
      const binding = { caller, generation: Symbol(manifest.descriptor.id), descriptor: manifest.descriptor, package: verified.package, compatible: true };
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
    const binding = [...this.callers.values()].find(row => row.package.packageName === packageName);
    if (!binding) throw new Error('workbench/unregistered-package');
    const entry = binding;
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
    if (verified.compatible !== binding.compatible) throw new Error('workbench/installation-changed');
    return Object.freeze({ descriptor: parseWorkbenchDescriptor(entry.descriptor), package: Object.freeze({ ...verified.package }), enabled: true, compatible: verified.compatible });
  }

  list() { this.assertOpen(); return this.registry.list(); }
  close() {if(this.closed)return;this.closed=true;for(const dispose of this.disposers)dispose();}
  private assertOpen() {if(this.closed)throw new Error('workbench/registration-service-closed');}

  /** Public lifecycle adapter must use this method rather than retaining an unmanaged registration. */
  async registerManaged(caller: WorkbenchCallerContext & { effect(body: () => (() => void), label?: string): () => void | Promise<void> }, declaration: unknown, page: Page, signal?: AbortSignal): Promise<() => void | Promise<void>> {
    let dispose: () => void;
    try { dispose = await this.register(caller, declaration, page, signal); }
    catch (cause) {
      if (!(cause instanceof IncompatibleWorkbenchRegistration)) throw cause;
      this.assertOpen(); signal?.throwIfAborted();
      const current = resolveWorkbenchLoaderSource(this.loader, caller);
      if (current.entryId !== cause.source.entryId || current.moduleName !== cause.source.moduleName) throw new Error('workbench/caller-source-changed');
      const { installation } = cause;
      if (this.callers.has(installation.descriptor.id)) throw new Error('workbench/registration-conflict');
      const binding = { caller, generation: Symbol(installation.descriptor.id), ...installation };
      this.callers.set(installation.descriptor.id, binding);
      dispose = () => {
        if (this.callers.get(installation.descriptor.id) === binding) this.callers.delete(installation.descriptor.id);
        this.disposers.delete(dispose);
      };
      this.disposers.add(dispose);
    }
    try { return caller.effect(() => dispose, 'workdsh.workbench.registration'); }
    catch (cause) { dispose(); throw cause; }
  }
}
