import { Worker } from 'node:worker_threads';
export class QualityWorkerFailure extends Error { constructor(readonly code:string) {super(`quality/worker/${code}`);} }
export class BoundedQualityWorker<Input, Output> {
  private readonly workers = new Set<Worker>();
  private closed = false;
  constructor(private readonly workerEntry: URL, private readonly decode: (message: unknown) => Output, private readonly timeoutMs = 10000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new QualityWorkerFailure('invalid-timeout');
  }
  async execute(input: Input, signal?: AbortSignal): Promise<Output> {
    if (this.closed) throw new QualityWorkerFailure('closed');
    signal?.throwIfAborted();
    if (this.workers.size >= 2) throw new QualityWorkerFailure('busy');
    // Snapshot before asynchronous work; never detach or mutate caller buffers.
    const snapshot = structuredClone(input);
    const worker = new Worker(this.workerEntry, { workerData: snapshot,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    this.workers.add(worker);
    return new Promise<Output>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, result?: Output) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        // Keep concurrency reservation until the actual worker has stopped.
        void worker.terminate().finally(() => this.workers.delete(worker));
        if (error) reject(error); else resolve(result!);
      };
      const abort = () => finish(signal?.reason ?? new QualityWorkerFailure('aborted'));
      const timer = setTimeout(() => finish(new QualityWorkerFailure('timeout')), this.timeoutMs);
      worker.once('error', () => finish(new QualityWorkerFailure('worker-failed')));
      worker.once('exit', () => finish(new QualityWorkerFailure(this.closed ? 'closed' : 'worker-exited')));
      worker.once('message', message => {
        if (signal?.aborted) { abort(); return; }
        try { finish(undefined, this.decode(message)); }
        catch (cause) { finish(cause); }
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.workers].map(worker => worker.terminate()));
    this.workers.clear();
  }
}
