import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Preview business Sessions and storage belong to the user's runtime data,
// outside the source checkout. Explicit isolated test Homes remain supported.
export function previewHome(env = process.env) {
  return resolve(env.WORKDSH_PREVIEW_HOME ?? join(homedir(), '.workdsh', 'preview'));
}
