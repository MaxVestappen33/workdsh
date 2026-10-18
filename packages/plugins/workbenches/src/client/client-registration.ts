import { parseWorkbenchDescriptor, workbenchActivationState, type WorkbenchDescriptor } from 'workdsh-contracts';
import { WorkbenchRegistry, type WorkbenchRegistrationAuthority } from '../runtime/registry.js';
import { resolveWorkbenchLoaderSource, type WorkbenchCallerContext, type WorkbenchLoader, type WorkbenchLoaderSource } from '../runtime/loader-source.js';
import { WorkbenchPageLifecycle, type WorkbenchPagePorts } from './page-lifecycle.js';

/** Must inspect actual Host installation facts; a Client declaration or package
 * name alone cannot supply authority. The production transport remains separate. */
export type VerifyClientWorkbenchInstallation = (packageName: string, signal?: AbortSignal) => Promise<WorkbenchRegistrationAuthority>;
class IncompatibleClientWorkbenchRegistration extends Error {
  constructor(readonly authority: WorkbenchRegistrationAuthority, readonly source: WorkbenchLoaderSource) { super('workbench/incompatible-host'); }
}
export class ClientWorkbenchRegistration<Page> {
  private closed = false;
  private readonly pending = new Set<AbortController>();
  private readonly authorities = new WeakMap<object, WorkbenchRegistrationAuthority>();
  private readonly registry = new WorkbenchRegistry<Page>(caller => this.authorities.get(caller));
  private readonly pages: WorkbenchPageLifecycle<Page>;
  private readonly releases = new Set<() => void>();
  constructor(private readonly loader: WorkbenchLoader, private readonly verify: VerifyClientWorkbenchInstallation, ports: WorkbenchPagePorts<Page>) {
    this.pages = new WorkbenchPageLifecycle(ports);
  }
  async register(caller: WorkbenchCallerContext, declaration: WorkbenchDescriptor, Page: Page, signal?: AbortSignal) {
    if (this.closed) throw new Error('workbench/registration-service-closed');
    const controller = new AbortController(); this.pending.add(controller);
    const lifetime = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    try {
      lifetime.throwIfAborted();
      const source = resolveWorkbenchLoaderSource(this.loader, caller);
      const authority = await this.verify(source.packageName, lifetime);
      lifetime.throwIfAborted();
      if (this.closed) throw new Error('workbench/registration-service-closed');
      const current = resolveWorkbenchLoaderSource(this.loader, caller);
      if (source.entryId !== current.entryId || source.moduleName !== current.moduleName) throw new Error('workbench/caller-source-changed');
      if (authority.package.packageName !== source.packageName) throw new Error('workbench/installation-changed');
      const descriptor = parseWorkbenchDescriptor(declaration);
      const canonical = (value: WorkbenchDescriptor) => JSON.stringify({ ...parseWorkbenchDescriptor(value), capabilities: [...value.capabilities].sort() });
      if (canonical(descriptor) !== canonical(authority.descriptor)) throw new Error('workbench/declaration-mismatch');
      if (!authority.enabled) throw new Error('workbench/package-disabled');
      workbenchActivationState({ installed: authority.package, enabled: true, compatible: authority.compatible });
      if (!authority.compatible) throw new IncompatibleClientWorkbenchRegistration(authority, source);
      this.authorities.set(caller, authority);
      let unregister: (() => void) | undefined;
      try { unregister = this.registry.register(caller, descriptor, Page); }
      finally { this.authorities.delete(caller); }
      let withdraw;
      try { withdraw = this.pages.mount(descriptor, Page); }
      catch (cause) { unregister(); throw cause; }
      if (this.closed) { try { withdraw(); } finally { unregister(); } throw new Error('workbench/registration-service-closed'); }
      let released = false;
      const release = () => {
        if (released) return; released = true; this.releases.delete(release);
        try { withdraw(); } finally { unregister(); }
      };
      this.releases.add(release); return release;
    } finally { this.pending.delete(controller); }
  }
  async registerManaged(caller: WorkbenchCallerContext & { effect(body: () => (() => void), label?: string): () => void | Promise<void> },
    declaration: WorkbenchDescriptor, Page: Page, signal?: AbortSignal) {
    let release: () => void;
    try { release = await this.register(caller, declaration, Page, signal); }
    catch (cause) {
      if (!(cause instanceof IncompatibleClientWorkbenchRegistration)) throw cause;
      if (this.closed) throw new Error('workbench/registration-service-closed');
      signal?.throwIfAborted();
      const current = resolveWorkbenchLoaderSource(this.loader, caller);
      if (current.entryId !== cause.source.entryId || current.moduleName !== cause.source.moduleName) throw new Error('workbench/caller-source-changed');
      // An incompatible verified package owns no Client page or navigation.
      // Keep a disposable lifecycle so the official plugin graph can finish.
      release = () => { this.releases.delete(release); };
      this.releases.add(release);
    }
    try { return caller.effect(() => release, 'workdsh.workbench.client-registration'); }
    catch (cause) { release(); throw cause; }
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const pending of this.pending) pending.abort();
    const errors = [];
    for (const release of [...this.releases]) try { release(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'workbench/page-cleanup-failed');
  }
}
