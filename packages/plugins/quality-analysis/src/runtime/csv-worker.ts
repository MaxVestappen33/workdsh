import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { parseCompleteQualityCsv, QualityCsvError } from '../domain/csv';

if (!parentPort) throw new Error('quality/worker-only');
try {
  if (!(workerData instanceof Uint8Array)) throw new Error('quality/invalid-worker-input');
  const table = parseCompleteQualityCsv(workerData);
  const sha256 = createHash('sha256').update(workerData).digest('hex');
  parentPort.postMessage({ ok: true, table, sha256 });
} catch (cause) {
  parentPort.postMessage({ ok: false, code: cause instanceof QualityCsvError ? cause.code : 'worker-failed',
    ...(cause instanceof QualityCsvError ? { record: cause.record } : {}) });
}
