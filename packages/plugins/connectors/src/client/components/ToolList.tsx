/** 详情弹窗里的工具清单：工具名（等宽）、类型标签、描述、参数说明四行信息。 */
export interface ConnectorTool {
  readonly name: string;
  readonly kind?: string;
  readonly description?: string;
  readonly params?: string;
}

/** 表头固定在清单顶部，只有工具条目区滚动：工具很多时「共 N 个」始终可见。 */
export function ToolList({ title, tools, empty, denied }: {
  title: string;
  tools: readonly ConnectorTool[];
  empty: string;
  /** 未授权的工具名：整条置灰并加「未授权」标签，模型侧已隐藏，界面只做解释。 */
  denied?: ReadonlySet<string>;
}) {
  return (
    <div className="tool-list">
      <div className="tool-list-head">
        <span>{title}</span>
        <span className="muted">{tools.length} 个</span>
      </div>
      <div className="tool-list-body">
        {tools.length ? (
          tools.map((tool, index) => {
            const blocked = denied?.has(tool.name) === true;
            return (
              <div className={`tool-item${blocked ? ' is-denied' : ''}`} key={tool.name}>
                <div className="tool-item-top">
                  <i className="tool-index">{index + 1}.</i>
                  <code>{tool.name}</code>
                  {blocked
                    ? <span className="tool-tag denied" title="当前账号未获得该工具的使用授权。">未授权</span>
                    : tool.kind ? <span className="tool-tag">{tool.kind}</span> : null}
                </div>
                {tool.description ? <p>{tool.description}</p> : null}
                {tool.params ? <small>参数：{tool.params}</small> : null}
              </div>
            );
          })
        ) : (
          <p className="tool-empty">{empty}</p>
        )}
      </div>
    </div>
  );
}
