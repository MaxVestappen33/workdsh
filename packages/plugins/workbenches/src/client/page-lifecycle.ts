import { parseWorkbenchDescriptor, type WorkbenchDescriptor } from 'workdsh-contracts';

export interface WorkbenchPageMount {
  readonly panelKey: string;
  readonly descriptor: WorkbenchDescriptor;
  /** Abort page requests when the plugin is withdrawn, including retained components. */
  readonly signal: AbortSignal;
}
/** Internal adapter ports, implemented with the official Slots and layout services. */
export interface WorkbenchPagePorts<Page> {
  mountPage(mount: WorkbenchPageMount, page: Page): () => void;
  selectedPanel(): string | undefined;
  openManager(): void;
}

/** Receives only registrations already verified by the platform's caller/source adapter. */
export class WorkbenchPageLifecycle<Page> {
  private readonly active = new Map<string, () => void>();
  private closed = false;
  constructor(private readonly ports: WorkbenchPagePorts<Page>) {}

  mount(declaration: WorkbenchDescriptor, page: Page): () => void {
    if (this.closed) throw new Error('workbench/page-service-closed');
    const descriptor = parseWorkbenchDescriptor(declaration);
    if (this.active.has(descriptor.id)) throw new Error('workbench/registration-conflict');
    const lifetime = new AbortController();
    const mount = Object.freeze({ descriptor, panelKey: `workdsh-workbench:${descriptor.id}`, signal: lifetime.signal });
    const disposers: (() => void)[] = [];
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      // Remove the identity before callbacks: a stale disposer must not remove a later activation.
      if (this.active.get(descriptor.id) === dispose) this.active.delete(descriptor.id);
      lifetime.abort();
      const errors: unknown[] = [];
      try { if (this.ports.selectedPanel() === mount.panelKey) this.ports.openManager(); }
      catch (cause) { errors.push(cause); }
      for (const cleanup of disposers.reverse()) {
        try { cleanup(); } catch (cause) { errors.push(cause); }
      }
      if (errors.length) throw new AggregateError(errors, 'workbench/page-cleanup-failed');
    };
    this.active.set(descriptor.id, dispose);
    try {
      // Register the business page for opening from the manager list.
      const retain = (cleanup: () => void) => {
        if (disposed) {
          cleanup();
          throw new Error('workbench/page-service-closed');
        }
        disposers.push(cleanup);
      };
      retain(this.ports.mountPage(mount, page));
      return dispose;
    } catch (cause) {
      try { dispose(); } catch (cleanupError) { throw new AggregateError([cause, cleanupError], 'workbench/page-mount-failed'); }
      throw cause;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const dispose of [...this.active.values()]) {
      try { dispose(); } catch (cause) { errors.push(cause); }
    }
    if (errors.length) throw new AggregateError(errors, 'workbench/page-cleanup-failed');
  }
}
