import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-workspace-controller';
import type { WorkbenchDevelopment } from 'workdsh-contracts';

/** Existing official registry owns workspace identity. Call only after the Host
 * has verified current source directory and actor access; no path comes from UI. */
export async function ensureWorkbenchDevelopmentWorkspace(ctx: Pick<Context, 'workspaceController'>,
  development: WorkbenchDevelopment, title: string, authorize: () => void, signal?: AbortSignal) {
  signal?.throwIfAborted(); authorize();
  if (!development.source || development.source.hostId !== development.target.hostId) throw new Error('workbench/development-source-unavailable');
  if (!title.trim() || title.length > 80) throw new Error('workbench/invalid-workspace-title');
  const source = { ...development.source }, id = development.id;
  const { workspace, created } = await ctx.workspaceController.create({ path: source.directory });
  signal?.throwIfAborted(); authorize();
  const desiredTitle = `${title.trim()} · ${id.slice(0, 8)}`;
  // A registered source directory may already belong to a project workspace.
  // Reuse its identity and presentation rather than renaming another feature's work.
  if (!created || workspace.title === desiredTitle) return workspace;
  const updated = await ctx.workspaceController.rename({ workspaceId: workspace.workspaceId, title: desiredTitle });
  signal?.throwIfAborted(); authorize();
  return updated.workspace;
}
