import * as React from 'react';
import { useEffect, useState } from 'react';
import type { SkillManagementClient } from './management.js';

/** 提示保留时长：超过这个时间的拒绝记录不再展示，避免旧提示长期挂在输入框上。 */
const NOTICE_TTL_MS = 10 * 60_000;
/** 轮询间隔：拒绝发生在宿主侧，客户端只能轮询；3 秒足够及时且开销可忽略。 */
const POLL_MS = 3_000;

/**
 * 技能被闸门拒绝后的提示条（ant-design Alert 风格）。
 *
 * 斜杠技能被拒时内容不会进入模型上下文，模型只能自行解释；这条提示把「哪个技能、为什么」
 * 直接展示在该轮对话末尾（消息列表内、输入框上方），口径与宿主 `agent/pre-step` 的拦截一致。
 * 宽度与对话内容列一致，文案居中并在放不下时换行，右侧可关闭。
 */
export function SkillDenialNotice({ management, sessionId, turn }: {
  readonly management: SkillManagementClient;
  readonly sessionId?: string;
  /** 当前轮次：只在该轮有拒绝记录时展示，避免提示复制到每轮末尾。 */
  readonly turn?: { readonly number: number };
}) {
  const [names, setNames] = useState<readonly string[]>([]);
  /** 被关闭的是哪一条提示（轮次 + 时间戳）：新提示到来后自动重新出现。 */
  const [dismissed, setDismissed] = useState('');
  const [noticeKey, setNoticeKey] = useState('');
  useEffect(() => {
    if (!sessionId) { setNames([]); setNoticeKey(''); return; }
    let live = true;
    const tick = async () => {
      try {
        const value = await management.skillDenials(sessionId);
        if (!live) return;
        const current = value && Date.now() - value.at < NOTICE_TTL_MS && (turn === undefined || value.turn === turn.number) ? value : undefined;
        setNoticeKey(current ? `${current.turn}:${current.at}` : '');
        setNames(current ? current.names : []);
      } catch { /* 提示是附加能力：读取失败不影响会话 */ }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [management, sessionId, turn?.number]);
  if (!names.length || dismissed === noticeKey) return null;
  return <div
    role="alert"
    style={{
      // 与输入框卡片等宽：官方布局用这两个变量控制卡片宽度与两侧留白。
      width: 'calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px))',
      maxWidth: 'var(--dsh-composer-card-max-width, 860px)',
      boxSizing: 'border-box', margin: '4px auto 12px',
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 12px', borderRadius: 8,
      border: '1px solid #ffe58f', background: '#fffbe6', color: '#ad6800', fontSize: 13, lineHeight: 1.6,
    }}
  >
    <span style={{ flex: 1, minWidth: 0, textAlign: 'center', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
      技能 {names.map(name => `/${name}`).join('、')} 未上架或未授权，已拒绝调用；请到「技能管理 · 技能市场」申请或安装后再使用。
    </span>
    <button
      type="button"
      aria-label="关闭提示"
      onClick={() => setDismissed(noticeKey)}
      style={{
        flex: '0 0 auto', border: 0, background: 'transparent', color: 'inherit',
        cursor: 'pointer', fontSize: 14, lineHeight: 1.4, padding: 0,
      }}
    >×</button>
  </div>;
}
