/** System topology is design metadata, never an authorization or executable route. */
export interface WorkbenchSystemModule {
  readonly id: string;
  readonly title: string;
  readonly pages: readonly { readonly id: string; readonly title: string }[];
  readonly dependsOn: readonly string[];
}
export interface WorkbenchSystemDefinition {
  readonly schemaVersion: '1';
  readonly modules: readonly WorkbenchSystemModule[];
}
export function parseWorkbenchSystemDefinition(value: unknown): WorkbenchSystemDefinition {
  const fail = (): never => { throw new Error('workbench/invalid-system-definition'); };
  const object = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return fail();
    return value as Record<string, unknown>;
  };
  const text = (value: unknown, id = false): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 80 || (id && !/^[a-z][a-z0-9._-]*$/.test(value))) return fail();
    return value.trim();
  };
  const root = object(value, ['schemaVersion', 'modules']);
  if (root.schemaVersion !== '1' || !Array.isArray(root.modules) || !root.modules.length || root.modules.length > 64) return fail();
  const moduleIds = new Set<string>(), pageIds = new Set<string>();
  const modules = root.modules.map(value => {
    const input = object(value, ['id', 'title', 'pages', 'dependsOn']);
    const id = text(input.id, true);
    if (moduleIds.has(id) || !Array.isArray(input.pages) || !input.pages.length || input.pages.length > 16 || !Array.isArray(input.dependsOn) || input.dependsOn.length > 64) return fail();
    moduleIds.add(id);
    const pages = input.pages.map(value => {
      const page = object(value, ['id', 'title']);
      const pageId = text(page.id, true);
      if (pageIds.has(pageId)) return fail();
      pageIds.add(pageId);
      return Object.freeze({ id: pageId, title: text(page.title) });
    });
    const dependsOn = input.dependsOn.map(value => text(value, true));
    if (new Set(dependsOn).size !== dependsOn.length || dependsOn.includes(id)) return fail();
    return Object.freeze({ id, title: text(input.title), pages: Object.freeze(pages), dependsOn: Object.freeze(dependsOn) });
  });
  for (const module of modules) if (module.dependsOn.some(id => !moduleIds.has(id))) return fail();
  return Object.freeze({ schemaVersion: '1', modules: Object.freeze(modules) });
}

export interface WorkbenchEditTarget {
  readonly moduleId: string;
  readonly pageId?: string;
}
/** A conservative design dependency closure; actual code changes still require
 * impact review. This does not grant access to modules or filesystem locations.
 */
export function resolveWorkbenchEditTarget(definition: WorkbenchSystemDefinition, value: unknown) {
  const system = parseWorkbenchSystemDefinition(definition);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('workbench/invalid-edit-target');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['moduleId', 'pageId'].includes(key))) throw new Error('workbench/invalid-edit-target');
  const module = system.modules.find(module => module.id === input.moduleId);
  if (!module || (input.pageId !== undefined && !module.pages.some(page => page.id === input.pageId))) throw new Error('workbench/invalid-edit-target');
  const affected = new Set([module.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of system.modules) {
      if (!affected.has(candidate.id) && candidate.dependsOn.some(id => affected.has(id))) {
        affected.add(candidate.id); changed = true;
      }
    }
  }
  return Object.freeze({ target: Object.freeze({ moduleId: module.id, ...(input.pageId === undefined ? {} : { pageId: input.pageId as string }) }),
    affectedModuleIds: Object.freeze(system.modules.filter(module => affected.has(module.id)).map(module => module.id)) });
}
