import { expect, it } from 'vitest'
import { renderMarkdown } from '../src/update-markdown.ts'

it('renders headings, paragraphs and hard line breaks', () => {
  expect(renderMarkdown('# 标题\n\n第一行\n第二行')).toBe('<h1>标题</h1>\n<p>第一行<br>第二行</p>')
})

it('renders unordered, ordered and nested lists', () => {
  expect(renderMarkdown('- 一\n- 二\n  - 二点一\n- 三'))
    .toBe('<ul><li>一</li><li>二<ul><li>二点一</li></ul></li><li>三</li></ul>')
  expect(renderMarkdown('1. 第一步\n2. 第二步'))
    .toBe('<ol><li>第一步</li><li>第二步</li></ol>')
})

it('renders emphasis and inline code without letting code be formatted', () => {
  expect(renderMarkdown('**加粗** 与 *斜体* 与 `a_b_c`'))
    .toBe('<p><strong>加粗</strong> 与 <em>斜体</em> 与 <code>a_b_c</code></p>')
})

it('renders safe links and leaves unsafe protocols as text', () => {
  expect(renderMarkdown('[官网](https://example.test/a?b=1&c=2)'))
    .toBe('<p><a href="https://example.test/a?b=1&amp;c=2" target="_blank" rel="noreferrer noopener">官网</a></p>')
  expect(renderMarkdown('[点我](javascript:alert(1))'))
    .toBe('<p>[点我](javascript:alert(1))</p>')
})

it('escapes raw HTML instead of executing it', () => {
  expect(renderMarkdown('<img src=x onerror="alert(1)">'))
    .toBe('<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>')
  expect(renderMarkdown('<script>alert(1)</script>'))
    .toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
})

it('renders fenced code blocks with escaped content', () => {
  expect(renderMarkdown('```ts\nconst a = "<b>"\n```'))
    .toBe('<pre><code class="language-ts">const a = &quot;&lt;b&gt;&quot;</code></pre>')
})

it('renders blockquotes and horizontal rules', () => {
  expect(renderMarkdown('> 注意\n> 第二行\n\n---'))
    .toBe('<blockquote><p>注意</p><p>第二行</p></blockquote>\n<hr>')
})

it('returns an empty string for empty notes', () => {
  expect(renderMarkdown('')).toBe('')
  expect(renderMarkdown('\n\n')).toBe('')
})
