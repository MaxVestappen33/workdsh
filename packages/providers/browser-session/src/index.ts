/** Session-owned Chromium feeding the official Playwright MCP tool client. */

import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand';
import { SessionResources } from '@deepseek-ai/dsh-experimental-browser-use-runtime';
import * as McpClient from '@deepseek-ai/dsh-mcp-client';
import { createScope, type Scope } from '@deepseek-ai/dsh-scope';
import type {} from '@deepseek-ai/dsh-browser-use';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import { launchManagedChromium, type ManagedChromium } from './managed-chromium.js';
import { launchManagedElectron } from './managed-electron.js';
import { registerBrowserSessionConnection } from './remote.js';
import { browserToolActivity, type BrowserToolActivity } from './tool-activity.js';

/** A rendered view of the same page controlled by the Session's MCP tools. */
export interface BrowserFrame {
  readonly url: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly jpegBase64: string;
}

/** Host-only operations. A Remote adapter must resolve the authenticated live Agent first. */
export interface BrowserSessionView {
  available(agent: Agent): boolean;
  active(agent: Agent): boolean;
  revision(agent: Agent): number;
  capture(agent: Agent, signal: AbortSignal): Promise<BrowserFrame>;
  click(agent: Agent, x: number, y: number, signal: AbortSignal): Promise<BrowserFrame>;
  type(agent: Agent, text: string, signal: AbortSignal): Promise<BrowserFrame>;
  press(agent: Agent, key: string, signal: AbortSignal): Promise<BrowserFrame>;
  scroll(agent: Agent, deltaX: number, deltaY: number, signal: AbortSignal): Promise<BrowserFrame>;
  navigate(agent: Agent, url: string, signal: AbortSignal): Promise<BrowserFrame>;
}

declare module '@deepseek-ai/cordis' {
  interface Context { workdshBrowserSession: BrowserSessionView; }
}

export const name = 'workdsh-browser-session';
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt'];

export interface Config {
  /** Desktop reuses its own Electron Chromium in a private worker process. */
  electronExecutable?: string;
  /** Application directory for an unpackaged Electron binary; omitted by a packaged Desktop. */
  electronApplication?: string;
  /** Web-only fallback when Desktop's Electron worker is unavailable. */
  executablePath?: string;
  toolCallTimeoutMs?: number;
}

interface BrowserResource {
  browser: ManagedChromium;
  scope: Scope;
}

const MCP_NAME = 'workdsh-playwright';
const TOOL_PREFIX = `mcp__${MCP_NAME}__`;
const RESOURCE_TOOLS = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource']);

/** Register only for future Agent activations; existing sessions keep their original provider. */
export function apply(ctx: Context, config: Config): void {
  if (!config.electronExecutable?.trim() && !config.executablePath?.trim()) {
    throw new Error('workdsh-browser-session: Electron worker or browser executable is required');
  }
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js');
  // 输出目录必须由我们指定：默认值是会话 cwd 下的 .playwright-mcp，而 macOS 受保护目录
  // （如 ~/Documents）连宿主进程都没有写权限，会导致浏览器工具 EACCES 失败。
  const outputRoot = join(process.env.DSH_HOME?.trim() || tmpdir(), 'playwright-mcp');
  const scrubbedMcpEnv = Object.fromEntries(Object.keys(process.env)
    .filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_'))
    .map(key => [key, '']));
  let resources!: SessionResources<BrowserResource>;
  const ready = new Set<Agent>();
  const active = new Set<Agent>();
  const revisions = new Map<Agent, number>();
  let stopping = false;
  const activity = (agent: Agent, value: BrowserToolActivity) => {
    if (value === 'unchanged') return;
    if (value === 'page') active.add(agent); else active.delete(agent);
    revisions.set(agent, (revisions.get(agent) ?? 0) + 1);
  };

  const view = async (
    agent: Agent,
    signal: AbortSignal,
    action?: (page: import('playwright-core').Page) => Promise<void>,
  ): Promise<BrowserFrame> => {
    if (stopping || !ready.has(agent)) throw new Error(`${MCP_NAME}: Session browser is unavailable`);
    const revision = revisions.get(agent) ?? 0;
    return resources.run(agent, signal, async ({ browser }, combined) => {
      combined.throwIfAborted();
      const page = browser.context.pages().at(-1);
      if (!page || page.isClosed()) throw new Error(`${MCP_NAME}: Session has no browser page`);
      await action?.(page);
      combined.throwIfAborted();
      const viewport = page.viewportSize();
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 65, animations: 'disabled', timeout: 10_000 });
      combined.throwIfAborted();
      if (action && (revisions.get(agent) ?? 0) === revision) activity(agent, 'page');
      return {
        url: page.url(),
        title: await page.title(),
        width: viewport?.width ?? 1280,
        height: viewport?.height ?? 720,
        jpegBase64: jpeg.toString('base64'),
      };
    });
  };
  ctx.provide('workdshBrowserSession', {
    available: agent => !stopping && ready.has(agent) && resources.available(agent),
    active: agent => !stopping && active.has(agent) && resources.available(agent),
    revision: agent => revisions.get(agent) ?? 0,
    capture: (agent, signal) => view(agent, signal),
    click: (agent, x, y, signal) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 10_000 || y > 10_000) {
        throw new Error('browser click coordinates are invalid');
      }
      return view(agent, signal, page => page.mouse.click(x, y));
    },
    type: (agent, value, signal) => {
      if (typeof value !== 'string' || value.length > 4_000) throw new Error('browser text input is invalid');
      return view(agent, signal, page => page.keyboard.insertText(value));
    },
    press: (agent, key, signal) => {
      if (!['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
        throw new Error('browser key is invalid');
      }
      return view(agent, signal, page => page.keyboard.press(key));
    },
    scroll: (agent, deltaX, deltaY, signal) => {
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)
        || Math.abs(deltaX) > 10_000 || Math.abs(deltaY) > 10_000) {
        throw new Error('browser scroll deltas are invalid');
      }
      return view(agent, signal, page => page.mouse.wheel(deltaX, deltaY));
    },
    navigate: (agent, value, signal) => {
      let url: URL;
      try { url = new URL(value); }
      catch { throw new Error('browser URL is invalid'); }
      if (!['http:', 'https:'].includes(url.protocol) || value.length > 2_048) {
        throw new Error('browser URL is invalid');
      }
      return view(agent, signal, async page => { await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20_000 }); });
    },
  } satisfies BrowserSessionView);
  ctx.inject(['connection', 'workdshIdentity'], remote => registerBrowserSessionConnection(remote));

  ctx.effect(function* () {
    yield ctx.browserUse.register(BrowserUseProviderName(MCP_NAME));
    resources = new SessionResources(ctx, {
      label: MCP_NAME,
      exclusive: false,
      async open(agent, signal) {
        const browser = config.electronExecutable?.trim()
          ? await launchManagedElectron(config.electronExecutable, signal, config.electronApplication)
          : await launchManagedChromium(config.executablePath!, signal);
        const scope = createScope(ctx, agent);
        try {
          signal.throwIfAborted();
          scope.ctx.on('tools/execute', async (exec, next) => {
            if (!exec.name.startsWith(TOOL_PREFIX)) return next();
            if (exec.agent !== agent) {
              if (ctx.tools.get(exec.name, exec.agent) !== ctx.tools.get(exec.name, agent)) return next();
              throw new Error(`${MCP_NAME}: browser tool belongs to another Session`);
            }
            return next();
          });
          await scope.ctx.plugin(McpClient, McpClient.Config({
            transport: 'stdio',
            serverName: MCP_NAME,
            command: process.execPath,
            args: [cli, '--browser', 'chromium', '--cdp-endpoint', browser.endpoint, '--output-dir', join(outputRoot, String(agent.id))],
            env: scrubbedMcpEnv,
            ...agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd },
            ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
            failOnStartupError: true,
            reconnect: { enabled: false },
          }));
          signal.throwIfAborted();
          return {
            value: { browser, scope },
            async close() {
              ready.delete(agent);
              active.delete(agent);
              revisions.delete(agent);
              try { await scope.dispose(); }
              finally { await browser.close(); }
            },
          };
        } catch (error) {
          try { await scope.dispose(); }
          finally { await browser.close(); }
          throw error;
        }
      },
    });
    yield async () => {
      stopping = true;
      await resources.dispose();
      ready.clear();
      active.clear();
      revisions.clear();
    };
  }, 'workdsh.browser.sessions');

  // 会话创建不再等待浏览器：预热在后台进行。模型工具的 schema 在 agent/pre-step 之前
  // 就已快照，所以真正的保证点放在“消息准入”（prompt）与后续步骤上；这样点击新会话
  // 立即返回，而首条消息发出时浏览器工具已经注册完成。
  const warm = async (agent: Agent, signal?: AbortSignal): Promise<void> => {
    await resources.get(agent, signal);
    if (!stopping && ctx.agents.get(agent.id) === agent) ready.add(agent);
  };

  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.effect(() => () => { ready.delete(agent); active.delete(agent); revisions.delete(agent); }, 'workdsh.browser.activation');
    void warm(agent).catch(error => {
      if (!stopping) ctx.logger.warn(`${MCP_NAME}: browser prewarm failed: ${String(error)}`);
    });
    return undefined;
  }, { prepend: true });

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    // 团队/子代理等不经过 prompt 准入的路径仍需在步骤开始前确保可用。
    try { await warm(agent, signal); }
    catch (error) { if (!stopping) ctx.logger.warn(`${MCP_NAME}: browser unavailable for this step: ${String(error)}`); }
    return next();
  });

  ctx.inject(['sessionController'], scope => scope.effect(() => {
    // 首条用户消息的请求 schema 在准入之后才会组装，因此在这里等待一次预热。
    const controller = scope.sessionController as unknown as {
      prompt: (request: { sessionId: string }, signal: AbortSignal) => Promise<unknown>;
    };
    const original = controller.prompt;
    controller.prompt = async (request, signal) => {
      const agent = ctx.agents.get(request.sessionId as Agent['id']);
      if (agent !== undefined) {
        try { await warm(agent, signal); }
        catch (error) { if (!stopping) ctx.logger.warn(`${MCP_NAME}: browser unavailable for prompt: ${String(error)}`); }
      }
      return original.call(controller, request, signal) as Promise<unknown>;
    };
    return () => { controller.prompt = original; };
  }, 'workdsh.browser.prompt-gate'));

  ctx.on('tools/execute', async (exec, next) => {
    const ownResource = RESOURCE_TOOLS.has(exec.name)
      && typeof exec.arguments === 'object' && exec.arguments !== null
      && (exec.arguments as { server?: unknown }).server === MCP_NAME;
    if (!exec.name.startsWith(TOOL_PREFIX) && !ownResource) return next();
    const agent = exec.agent;
    if (stopping || agent === undefined) {
      throw new Error(`${MCP_NAME}: browser tool belongs to another Session`);
    }
    await warm(agent, exec.signal);
    const revision = revisions.get(agent) ?? 0;
    return resources.run(agent, exec.signal, async (_resource, combined) => {
      const original = exec.signal;
      exec.signal = combined;
      try {
        const result = await next();
        if (!result.isError) {
          const change = browserToolActivity(exec.name, exec.arguments);
          // A page action that began before a successful close must not revive
          // the closed view when its tool result arrives late.
          if (change === 'closed' || (revisions.get(agent) ?? 0) === revision) activity(agent, change);
        }
        return result;
      }
      finally { exec.signal = original; }
    });
  });
}
