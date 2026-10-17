import { parseWorkbenchDescriptor, type WorkbenchDescriptor, type WorkbenchPackageReceipt } from 'workdsh-contracts';

export interface WorkbenchRegistrationAuthority {
  readonly descriptor: WorkbenchDescriptor;
  readonly package: WorkbenchPackageReceipt;
  readonly enabled: boolean;
  readonly compatible: boolean;
}
/** Internal core. The lifecycle adapter resolves the caller from trusted installation metadata. */
export class WorkbenchRegistry<Page> {
  private readonly entries = new Map<string, { readonly descriptor: WorkbenchDescriptor; readonly page: Page; readonly package: WorkbenchPackageReceipt; readonly generation: symbol }>();
  constructor(private readonly resolveCaller: (caller: object) => WorkbenchRegistrationAuthority | undefined) {}

  register(caller: object, declaration: unknown, page: Page): () => void {
    const authority = this.resolveCaller(caller);
    if (!authority) throw new Error('workbench/unverified-caller');
    if (!authority.enabled) throw new Error('workbench/package-disabled');
    if (!authority.compatible) throw new Error('workbench/incompatible-host');
    const descriptor = parseWorkbenchDescriptor(declaration);
    const installedDescriptor = parseWorkbenchDescriptor(authority.descriptor);
    // Capability order carries no meaning; all other public metadata must agree.
    const canonical = (value: WorkbenchDescriptor) => JSON.stringify({ ...value, capabilities: [...value.capabilities].sort() });
    if (canonical(descriptor) !== canonical(installedDescriptor)) throw new Error('workbench/declaration-mismatch');
    if (this.entries.has(descriptor.id)) throw new Error('workbench/registration-conflict');
    const generation = Symbol(descriptor.id);
    this.entries.set(descriptor.id, { descriptor, page, package: Object.freeze({ ...authority.package }), generation });
    return () => {
      if (this.entries.get(descriptor.id)?.generation === generation) this.entries.delete(descriptor.id);
    };
  }

  list(): readonly { readonly descriptor: WorkbenchDescriptor; readonly page: Page; readonly package: WorkbenchPackageReceipt }[] {
    return Object.freeze([...this.entries.values()].map(({ descriptor, page, package: receipt }) => Object.freeze({ descriptor, page, package: receipt })));
  }
}
