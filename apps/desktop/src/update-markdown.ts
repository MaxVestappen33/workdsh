/**
 * 更新说明的 Markdown 渲染器。
 * 只实现发布说明常用子集（标题、段落、列表、引用、代码块、粗体/斜体、行内代码、链接、分隔线），
 * 并转义所有原始 HTML：更新窗口不执行脚本、不加载远程资源。
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ESCAPES[character]!)
}

/** 只允许 http(s) 链接；其它协议（javascript:、data: 等）按普通文本输出。 */
function renderLink(text: string, url: string): string {
  return `<a href="${url}" target="_blank" rel="noreferrer noopener">${text}</a>`
}

function formatInline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu, (_match, text: string, url: string) => renderLink(text, url))
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/gu, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/gu, '$1<em>$2</em>')
}

function renderInline(source: string): string {
  // 先按反引号切分，代码段内部不参与链接/强调解析。
  return source
    .split(/(`[^`\n]*`)/u)
    .map((part, index) => index % 2 === 1
      ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
      : formatInline(escapeHtml(part)))
    .join('')
}

interface ListEntry {
  readonly indent: number
  readonly ordered: boolean
  readonly text: string
}

/** 递归渲染列表：缩进更深的条目作为上一项的嵌套列表。 */
function renderList(entries: readonly ListEntry[], start: number, indent: number): { html: string, next: number } {
  const first = entries[start]
  if (first === undefined) return { html: '', next: start }
  const ordered = first.ordered
  const items: string[] = []
  let index = start

  while (index < entries.length) {
    const entry = entries[index]!
    if (entry.indent < indent) break
    // 同层类型变化（ul → ol）由外层开启新列表。
    if (entry.indent === indent && entry.ordered !== ordered) break

    index += 1
    let children = ''
    const child = entries[index]
    if (child !== undefined && child.indent > indent) {
      const nested = renderList(entries, index, child.indent)
      children = nested.html
      index = nested.next
    }
    items.push(`<li>${renderInline(entry.text)}${children}</li>`)
  }

  const tag = ordered ? 'ol' : 'ul'
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: index }
}

function isBlockStart(line: string): boolean {
  return /^\s{0,3}(?:#{1,6}\s|```|>\s?|(?:---|\*\*\*|___)\s*$)/u.test(line)
}

function isListLine(line: string): boolean {
  return /^(\s*)([-*+]|\d+\.)\s+/u.test(line)
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n')
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = /^\s{0,3}```([A-Za-z0-9+#_-]*)\s*$/u.exec(line)
    if (fence !== null) {
      const language = fence[1] ?? ''
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^\s{0,3}```\s*$/u.test(lines[index]!)) {
        body.push(lines[index]!)
        index += 1
      }
      if (index < lines.length) index += 1
      const className = language.length === 0 ? '' : ` class="language-${escapeHtml(language)}"`
      output.push(`<pre><code${className}>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      const level = heading[1]!.length
      output.push(`<h${level}>${renderInline(heading[2]!.trim())}</h${level}>`)
      index += 1
      continue
    }

    if (/^\s{0,3}(?:---|\*\*\*|___)\s*$/u.test(line)) {
      output.push('<hr>')
      index += 1
      continue
    }

    if (/^\s{0,3}>\s?/u.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^\s{0,3}>\s?/u.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(/^\s{0,3}>\s?/u, ''))
        index += 1
      }
      output.push(`<blockquote>${quoted.map(text => `<p>${renderInline(text)}</p>`).join('')}</blockquote>`)
      continue
    }

    if (isListLine(line)) {
      const entries: ListEntry[] = []
      while (index < lines.length) {
        const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/u.exec(lines[index]!)
        if (match === null) break
        entries.push({
          indent: match[1]!.replace(/\t/gu, '    ').length,
          ordered: /^\d+\.$/u.test(match[2]!),
          text: match[3]!,
        })
        index += 1
      }
      // 同层的 ul/ol 切换会把集合拆成多段，逐段渲染。
      let cursor = 0
      while (cursor < entries.length) {
        const rendered = renderList(entries, cursor, entries[cursor]!.indent)
        output.push(rendered.html)
        cursor = rendered.next
      }
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index]!
      if (current.trim() === '' || isBlockStart(current) || isListLine(current)) break
      paragraph.push(current.trim())
      index += 1
    }
    // 发布说明常用硬换行；按行拼接可保留阅读节奏，同时不引入原始 HTML。
    output.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`)
  }

  return output.join('\n')
}
