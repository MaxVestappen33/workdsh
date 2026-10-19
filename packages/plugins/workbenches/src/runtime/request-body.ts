export async function readWorkbenchRequestBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('workbench/invalid-request');
  const onAbort = () => { void reader.cancel(request.signal.reason).catch(() => undefined); };
  request.signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      request.signal.throwIfAborted();
      const result = await reader.read();
      request.signal.throwIfAborted();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 256 * 1024) { await reader.cancel(); throw new Error('workbench/request-size-limit'); }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('workbench/invalid-request'); }
  } finally { request.signal.removeEventListener('abort', onAbort); reader.releaseLock(); }
}
