import { Button, Input, Modal, Select, Textarea } from 'workdsh-ui';
import type { ConnectorConfigView } from '../../shared.js';

export type ConnectorDraft = {
  id?: string;
  title: string;
  description: string;
  serverName: string;
  transport: 'stdio' | 'streamable-http';
  command: string;
  argsText: string;
  url: string;
  authorizationToken: string;
  authorizationConfigured: boolean;
};

export const blankDraft = (): ConnectorDraft => ({
  title: '',
  description: '',
  serverName: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  url: '',
  authorizationToken: '',
  authorizationConfigured: false,
});

export const draftFromConfig = (row: ConnectorConfigView): ConnectorDraft => ({
  id: row.id,
  title: row.title,
  description: row.description,
  serverName: row.serverName,
  transport: row.transport,
  command: row.command ?? '',
  argsText: (row.args ?? []).join('\n'),
  url: row.url ?? '',
  authorizationToken: '',
  authorizationConfigured: row.authorizationConfigured,
});

type FormProps = {
  readonly draft: ConnectorDraft | undefined;
  readonly busy: boolean;
  readonly onChange: (next: ConnectorDraft) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
};

export function McpFormModal({ draft, busy, onChange, onClose, onSubmit }: FormProps) {
  return (
    <Modal open={Boolean(draft)} label={draft?.id ? '编辑 MCP' : '添加 MCP'} className="connector-config-dialog" onClose={onClose}>
      {draft ? (
        <>
          <h1>{draft.id ? '编辑 MCP' : '添加 MCP'}</h1>
          <p>{draft.id ? '只修改当前连接实例；保存后会重新连接。' : '可以继续添加多个 MCP 服务，每个服务使用独立命名空间。'}</p>
          <div className="connector-form">
            <label>
              显示名称
              <Input value={draft.title} onChange={event => onChange({ ...draft, title: event.currentTarget.value })} />
            </label>
            <label>
              服务标识
              <Input value={draft.serverName} placeholder="例如 github" onChange={event => onChange({ ...draft, serverName: event.currentTarget.value })} />
            </label>
            <label className="wide">
              说明
              <Input value={draft.description} onChange={event => onChange({ ...draft, description: event.currentTarget.value })} />
            </label>
            <label>
              传输方式
              <Select value={draft.transport} onChange={event => onChange({ ...draft, transport: event.currentTarget.value as ConnectorDraft['transport'] })}>
                <option value="stdio">stdio 本地进程</option>
                <option value="streamable-http">Streamable HTTP</option>
              </Select>
            </label>
            {draft.transport === 'stdio' ? (
              <>
                <label className="wide">
                  启动命令
                  <Input value={draft.command} placeholder="node / python3 / npx" onChange={event => onChange({ ...draft, command: event.currentTarget.value })} />
                </label>
                <label className="wide">
                  参数（每行一个）
                  <Textarea rows={3} value={draft.argsText} onChange={event => onChange({ ...draft, argsText: event.currentTarget.value })} />
                </label>
              </>
            ) : (
              <>
                <label className="wide">
                  MCP URL
                  <Input value={draft.url} placeholder="https://example.com/mcp" onChange={event => onChange({ ...draft, url: event.currentTarget.value })} />
                </label>
                <label className="wide">
                  访问令牌
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={draft.authorizationToken}
                    placeholder={draft.authorizationConfigured ? '已安全保存；留空表示保持不变' : '需要 Authorization 的服务在此填写'}
                    onChange={event => onChange({ ...draft, authorizationToken: event.currentTarget.value })}
                  />
                </label>
              </>
            )}
            <div className="form-note wide">访问令牌写入 DSH 官方凭据服务；连接器只保存引用，列表、详情和诊断不会返回令牌。</div>
            <div className="form-actions wide">
              <Button className="secondary" onClick={onClose}>取消</Button>
              <Button variant="primary" className="primary" disabled={busy || !draft.title.trim() || !draft.serverName.trim()} onClick={onSubmit}>
                保存并连接
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
