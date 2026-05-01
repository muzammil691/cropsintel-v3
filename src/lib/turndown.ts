// Phase 1.10am: lightweight HTML → Markdown helper used by the ComposeBar
// paste handler. We deliberately ship a small inline implementation rather
// than depending on the full `turndown` npm package — bundle cost matters and
// our needs are modest (basic block + inline conversion of clipboard HTML).
//
// If we hit a paste case the simple converter handles badly we can swap to
// the full library later; for now this covers Slack / GitHub / Linear blocks.

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'tr', 'td', 'th', 'thead',
  'tbody', 'br', 'hr',
])

// Convert a clipboard HTML string into reasonable Markdown.
// Falls back to the original text on parse error.
export function htmlToMarkdown(html: string): string {
  if (typeof window === 'undefined' || !html) return html

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    if (!doc.body) return html
    const md = serializeNode(doc.body).trim()
    return md
  } catch {
    return html
  }
}

function serializeNode(node: Node, listDepth = 0, listType: 'ul' | 'ol' | null = null, listIndex = 1): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()

  // Skip non-rendering nodes that often appear in clipboard HTML.
  if (tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'noscript') {
    return ''
  }

  if (tag === 'br') return '\n'
  if (tag === 'hr') return '\n\n---\n\n'

  if (tag.match(/^h[1-6]$/)) {
    const level = parseInt(tag.slice(1), 10)
    const inner = childrenToMd(el).trim()
    return `\n\n${'#'.repeat(level)} ${inner}\n\n`
  }

  if (tag === 'a') {
    const href = el.getAttribute('href') ?? ''
    const text = childrenToMd(el).trim()
    if (!href) return text
    if (text === href || !text) return href
    return `[${text}](${href})`
  }

  if (tag === 'img') {
    const src = el.getAttribute('src') ?? ''
    const alt = el.getAttribute('alt') ?? ''
    return src ? `![${alt}](${src})` : ''
  }

  if (tag === 'strong' || tag === 'b') return `**${childrenToMd(el)}**`
  if (tag === 'em' || tag === 'i') return `*${childrenToMd(el)}*`
  if (tag === 'code' && el.parentElement?.tagName.toLowerCase() !== 'pre') {
    return `\`${el.textContent ?? ''}\``
  }
  if (tag === 'pre') {
    const text = el.textContent ?? ''
    return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`
  }
  if (tag === 'blockquote') {
    const inner = childrenToMd(el).trim()
    return '\n\n' + inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n'
  }
  if (tag === 'ul' || tag === 'ol') {
    let out = '\n'
    let i = 1
    for (const child of Array.from(el.children)) {
      out += serializeNode(child, listDepth + 1, tag, i) + '\n'
      i++
    }
    return out + '\n'
  }
  if (tag === 'li') {
    const indent = '  '.repeat(Math.max(0, listDepth - 1))
    const marker = listType === 'ol' ? `${listIndex}.` : '-'
    const inner = childrenToMd(el, listDepth, listType).trim()
    return `${indent}${marker} ${inner}`
  }

  if (tag === 'table') {
    const rows = Array.from(el.querySelectorAll('tr'))
    if (rows.length === 0) return ''
    const lines: string[] = []
    rows.forEach((tr, idx) => {
      const cells = Array.from(tr.querySelectorAll('th, td'))
        .map(c => (c.textContent ?? '').trim().replace(/\|/g, '\\|'))
      lines.push(`| ${cells.join(' | ')} |`)
      if (idx === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
    })
    return '\n\n' + lines.join('\n') + '\n\n'
  }

  if (BLOCK_TAGS.has(tag)) {
    return `\n${childrenToMd(el)}\n`
  }

  return childrenToMd(el)
}

function childrenToMd(
  el: HTMLElement,
  listDepth = 0,
  listType: 'ul' | 'ol' | null = null,
): string {
  let out = ''
  for (const child of Array.from(el.childNodes)) {
    out += serializeNode(child, listDepth, listType)
  }
  return out
}

// Detect a Claude Code transcript pasted into the chat — markdown with
// leading `> ` quote characters on most lines. We use this hint to wrap the
// paste in a single quoted block instead of double-quoting it.
export function isClaudeCodeTranscript(text: string): boolean {
  if (!text) return false
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 3) return false
  const quoted = lines.filter(l => l.startsWith('>')).length
  return quoted / lines.length > 0.4
}
