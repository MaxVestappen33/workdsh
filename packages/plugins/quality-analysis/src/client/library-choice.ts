import type { LibraryTreeEntry } from 'workdsh-contracts';
import type { QualityLibraryChoice } from './QualityLibraryImport.js';
/** A display entry is only a reference. Host independently checks ownership and revision. */
export function qualityLibraryChoice(entry: LibraryTreeEntry): QualityLibraryChoice | undefined {
  const { asset, revision } = entry;
  if (entry.kind !== 'asset' || !asset || !revision || asset.status !== 'active' ||
    entry.assetId !== asset.id || revision.assetId !== asset.id ||
    (asset.kind !== 'csv' && asset.kind !== 'xlsx')) return undefined;
  return Object.freeze({ assetId: asset.id, revisionId: revision.id, title: entry.name, format: asset.kind });
}
