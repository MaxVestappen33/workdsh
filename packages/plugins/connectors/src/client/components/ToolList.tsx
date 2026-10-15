/** 详情弹窗里的工具清单：工具名（等宽）、类型标签、描述、参数说明四行信息。 */
export interface ConnectorTool {
  readonly name: string;
  readonly kind?: string;
  readonly description?: string;
  readonly params?: string;
}

export function ToolList({ title, tools, empty }: { title: string; tools: readonly ConnectorTool[]; empty: string }) {
  return (
    <div className="tool-list">
      <div className="tool-list-head">
        <span>{title}</span>
        <span className="muted">{tools.length} 个</span>
      </div>
      {tools.length ? (
        tools.map((tool) => (
          <div className="tool-item" key={tool.name}>
            <div className="tool-item-top">
              <code>{tool.name}</code>
              {tool.kind ? <span className="tool-tag">{tool.kind}</span> : null}
            </div>
            {tool.description ? <p>{tool.description}</p> : null}
            {tool.params ? <small>参数：{tool.params}</small> : null}
          </div>
        ))
      ) : (
        <p className="tool-empty">{empty}</p>
      )}
    </div>
  );
}
