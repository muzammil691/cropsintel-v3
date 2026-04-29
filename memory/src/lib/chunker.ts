// Smart chunking for markdown and code content.
// Target: 500–1500 tokens per chunk (~2000–6000 chars at 4 chars/token).

const MIN_CHUNK_CHARS = 200
const MAX_CHUNK_CHARS = 6000
const TARGET_CHUNK_CHARS = 3000

export interface TextChunk {
  content: string
  section?: string
  chunkIndex: number
}

// ---------------------------------------------------------------------------
// Markdown chunker — splits at h2 boundaries, then h3 if still too large
// ---------------------------------------------------------------------------
export function chunkMarkdown(text: string, basePath?: string): TextChunk[] {
  const lines = text.split('\n')
  const sections: Array<{ heading: string; content: string }> = []

  let currentHeading = basePath ?? 'Introduction'
  let currentLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() })
      }
      currentHeading = line.replace(/^##\s+/, '').trim()
      currentLines = [line]
    } else {
      currentLines.push(line)
    }
  }
  if (currentLines.length > 0 && currentLines.join('\n').trim()) {
    sections.push({ heading: currentHeading, content: currentLines.join('\n').trim() })
  }

  const chunks: TextChunk[] = []
  for (const section of sections) {
    const subchunks = splitIfTooLarge(section.content, section.heading)
    for (const sub of subchunks) {
      chunks.push({ content: sub.content, section: sub.section, chunkIndex: chunks.length })
    }
  }

  return chunks.filter(c => c.content.length >= MIN_CHUNK_CHARS)
}

// ---------------------------------------------------------------------------
// Code chunker — splits at function/class boundaries
// ---------------------------------------------------------------------------
export function chunkCode(text: string, filePath: string): TextChunk[] {
  // Try to split at top-level function/class declarations
  const boundaries = findCodeBoundaries(text)

  if (boundaries.length === 0) {
    // Fall back: chunk by raw size
    return chunkBySize(text, filePath)
  }

  const chunks: TextChunk[] = []
  let chunkIndex = 0

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i]
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : text.length
    const block = text.slice(start, end).trim()

    if (block.length < MIN_CHUNK_CHARS) continue

    if (block.length > MAX_CHUNK_CHARS) {
      // Split oversized block by size
      const subchunks = chunkBySize(block, filePath)
      for (const sub of subchunks) {
        chunks.push({ content: sub.content, section: filePath, chunkIndex: chunkIndex++ })
      }
    } else {
      chunks.push({ content: block, section: filePath, chunkIndex: chunkIndex++ })
    }
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Generic size-based chunker (fallback)
// ---------------------------------------------------------------------------
export function chunkBySize(text: string, section?: string): TextChunk[] {
  const chunks: TextChunk[] = []
  let offset = 0
  let chunkIndex = 0

  while (offset < text.length) {
    let end = offset + TARGET_CHUNK_CHARS
    if (end >= text.length) {
      end = text.length
    } else {
      // Try to break at a newline near the target
      const newline = text.lastIndexOf('\n', end)
      if (newline > offset + MIN_CHUNK_CHARS) end = newline
    }

    const block = text.slice(offset, end).trim()
    if (block.length >= MIN_CHUNK_CHARS) {
      chunks.push({ content: block, section, chunkIndex: chunkIndex++ })
    }
    offset = end
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Conversation chunker — each user+assistant turn is one chunk
// ---------------------------------------------------------------------------
export interface ConversationTurn {
  userMessage: string
  assistantMessage: string
  turnIndex: number
}

export function chunkConversation(turns: ConversationTurn[]): TextChunk[] {
  return turns
    .map((turn, idx) => {
      const content = `[User]\n${turn.userMessage}\n\n[Assistant]\n${turn.assistantMessage}`.trim()
      return { content, section: `turn-${turn.turnIndex}`, chunkIndex: idx }
    })
    .filter(c => c.content.length >= MIN_CHUNK_CHARS)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitIfTooLarge(
  content: string,
  heading: string,
): Array<{ content: string; section: string }> {
  if (content.length <= MAX_CHUNK_CHARS) {
    return [{ content, section: heading }]
  }

  // Try splitting at h3 boundaries
  const h3Pattern = /^### /m
  if (h3Pattern.test(content)) {
    const lines = content.split('\n')
    const subsections: Array<{ heading: string; content: string }> = []
    let subHeading = heading
    let subLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('### ')) {
        if (subLines.length > 0) {
          subsections.push({ heading: subHeading, content: subLines.join('\n').trim() })
        }
        subHeading = `${heading} > ${line.replace(/^###\s+/, '').trim()}`
        subLines = [line]
      } else {
        subLines.push(line)
      }
    }
    if (subLines.length > 0) {
      subsections.push({ heading: subHeading, content: subLines.join('\n').trim() })
    }

    const result: Array<{ content: string; section: string }> = []
    for (const sub of subsections) {
      if (sub.content.length > MAX_CHUNK_CHARS) {
        const sized = chunkBySize(sub.content, sub.heading)
        result.push(...sized.map(c => ({ content: c.content, section: sub.heading })))
      } else if (sub.content.length >= MIN_CHUNK_CHARS) {
        result.push({ content: sub.content, section: sub.heading })
      }
    }
    return result
  }

  // Fall back to size-based splitting
  return chunkBySize(content, heading).map(c => ({ content: c.content, section: heading }))
}

function findCodeBoundaries(text: string): number[] {
  const boundaries: number[] = [0]
  const lines = text.split('\n')
  let offset = 0

  const topLevelPattern =
    /^(export\s+)?(default\s+)?(async\s+)?(function|class|const|let|var)\s+\w/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i > 0 && topLevelPattern.test(line)) {
      boundaries.push(offset)
    }
    offset += line.length + 1 // +1 for \n
  }

  return boundaries
}
