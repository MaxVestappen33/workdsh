/** Page use is distinct from browser cleanup and read-only diagnostics. */
export type BrowserToolActivity = 'page' | 'closed' | 'unchanged';
const PREFIX = 'mcp__workdsh-playwright__';
const PAGE_TOOLS = new Set([
  'browser_open', 'browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_take_screenshot',
  'browser_click', 'browser_drag', 'browser_drop', 'browser_hover', 'browser_select_option', 'browser_fill_form',
  'browser_type', 'browser_press_key', 'browser_press_sequentially', 'browser_handle_dialog', 'browser_resize',
  'browser_wait_for', 'browser_evaluate', 'browser_run_code', 'browser_run_code_unsafe', 'browser_file_upload',
  'browser_mouse_move_xy', 'browser_mouse_click_xy', 'browser_mouse_drag_xy', 'browser_mouse_down',
  'browser_mouse_up', 'browser_mouse_wheel',
]);
export function browserToolActivity(name: string, args: unknown): BrowserToolActivity {
  if (!name.startsWith(PREFIX)) return 'unchanged';
  const tool = name.slice(PREFIX.length);
  if (tool === 'browser_close') return 'closed';
  if (tool === 'browser_tabs') {
    const action = args && typeof args === 'object' ? (args as { action?: unknown }).action : undefined;
    return action === 'close' ? 'closed' : action === 'new' || action === 'select' ? 'page' : 'unchanged';
  }
  return PAGE_TOOLS.has(tool) ? 'page' : 'unchanged';
}
