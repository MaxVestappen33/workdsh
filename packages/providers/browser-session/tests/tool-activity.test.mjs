import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/tool-activity.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
const { browserToolActivity } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const tool = (name, args) => browserToolActivity(`mcp__workdsh-playwright__${name}`, args);
test('cleanup and read-only browser diagnostics never announce page use', () => {
  assert.equal(tool('browser_close'), 'closed');
  assert.equal(tool('browser_tabs', { action: 'close' }), 'closed');
  for (const [name, args] of [['browser_tabs', { action: 'list' }], ['browser_tabs', {}], ['browser_install'], ['browser_console_messages'], ['browser_network_requests'], ['browser_get_config'], ['browser_start_tracing'], ['browser_generate_locator'], ['browser_future_tool'], ['list_mcp_resources']]) assert.equal(tool(name, args), 'unchanged', name);
  assert.equal(browserToolActivity('mcp__another-session__browser_navigate', {}), 'unchanged');
});
test('normal navigation, snapshots, page interaction and explicit tab opening remain visible', () => {
  for (const name of ['browser_navigate', 'browser_snapshot', 'browser_take_screenshot', 'browser_click', 'browser_evaluate', 'browser_fill_form', 'browser_mouse_wheel']) assert.equal(tool(name), 'page', name);
  for (const action of ['new', 'select']) assert.equal(tool('browser_tabs', { action }), 'page');
});
