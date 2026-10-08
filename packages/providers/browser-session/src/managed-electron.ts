/** Browser worker backed by the Chromium already shipped inside Desktop's Electron. */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import type { ManagedChromium } from './managed-chromium.js';

async function vacantPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('browser worker did not reserve a TCP port');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(3_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

/** A failing worker explains itself on its output streams; keep the tail for the thrown error. */
function workerDetail(workerOutput: string): string {
  const collapsed = workerOutput.replace(/\s+/gu, ' ').trim();
  return collapsed.length === 0 ? '' : `; worker output: ${collapsed.slice(0, 600)}`;
}

/**
 * Chromium keeps handles on its profile for a moment after the worker exits, so
 * Windows reports EBUSY. A leftover temporary profile is harmless, and cleanup
 * must never mask the real result of the launch either way.
 */
async function removeProfile(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  } catch { /* A locked temporary profile is left for the OS to reclaim. */ }
}

async function readyEndpoint(port: number, child: ChildProcess, workerOutput: () => string, signal?: AbortSignal): Promise<string> {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  let startupError: Error | undefined;
  child.once('error', error => { startupError = error; });
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Electron browser worker exited before startup${workerDetail(workerOutput())}`);
    }
    try {
      const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        const pages = await response.json() as Array<{ type?: string }>;
        if (pages.some(page => page.type === 'page')) return endpoint;
      }
    } catch { /* Worker may still be starting. */ }
    await delay(50, undefined, { signal });
  }
  throw new Error(`Electron browser worker did not publish a page${workerDetail(workerOutput())}`);
}

/** Start one hidden Electron instance whose CDP exposes no WorkDSH app page. */
export async function launchManagedElectron(executable: string, appPath?: string, signal?: AbortSignal): Promise<ManagedChromium> {
  if (!executable.trim()) throw new Error('Desktop Electron executable is required');
  signal?.throwIfAborted();
  const profileDir = await mkdtemp(join(tmpdir(), 'workdsh-electron-browser-'));
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  let workerOutput = '';
  try {
    const port = await vacantPort();
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // A packaged carrier embeds the WorkDSH entry point, but a development
    // Electron binary only loads `workdsh-main.js` when its application
    // directory is passed. Chromium only recognises a positional path after the
    // switches, so the directory must come last. Without it Electron prints its
    // usage text and never applies `--remote-debugging-port`, which means no CDP
    // page is ever published.
    const appArguments = appPath?.trim() ? [appPath] : [];
    child = spawn(executable, [
      `--workdsh-browser-worker-port=${port}`,
      `--workdsh-browser-worker-profile=${profileDir}`,
      ...appArguments,
    ], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const captureWorkerOutput = (chunk: Buffer): void => {
      workerOutput = `${workerOutput}${chunk.toString('utf8')}`.slice(-2_048);
    };
    child.stdout?.on('data', captureWorkerOutput);
    child.stderr?.on('data', captureWorkerOutput);
    const endpoint = await readyEndpoint(port, child, () => workerOutput, signal);
    browser = await chromium.connectOverCDP(endpoint);
    const context: BrowserContext | undefined = browser.contexts()[0];
    if (!context || context.pages().length === 0) throw new Error('Electron browser worker has no page');
    const ownedWorker = child;
    const ownedBrowser = browser;
    let closing: Promise<void> | undefined;
    return {
      endpoint, profileDir, context,
      close: () => closing ??= (async () => {
        try { await ownedBrowser.close(); }
        finally {
          try { await stopWorker(ownedWorker); }
          finally { await removeProfile(profileDir); }
        }
      })(),
    };
  } catch (error) {
    try { await browser?.close(); }
    finally {
      try { if (child) await stopWorker(child); }
      finally { await removeProfile(profileDir); }
    }
    throw error;
  }
}
