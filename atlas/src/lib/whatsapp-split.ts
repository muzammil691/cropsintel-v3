// Phase 1.10aw — sentence-aware WhatsApp message splitter.
//
// Twilio rejects WhatsApp text bodies > 1600 chars. We cap at 1500 to leave
// room for the `(part N/M)` suffix. The splitter respects paragraph + sentence
// boundaries and never breaks a word; if no clean boundary fits, it falls back
// to a soft word-boundary cut so that nothing is silently truncated.

export const TWILIO_LIMIT = 1500
const SUFFIX_RESERVE = 16 // " (part 99/99)"

interface AccumulatorChunk {
  text: string
}

function pushChunk(chunks: AccumulatorChunk[], current: { text: string }): void {
  const trimmed = current.text.trim()
  if (trimmed.length > 0) chunks.push({ text: trimmed })
  current.text = ''
}

function appendToCurrent(current: { text: string }, piece: string, separator = '\n\n'): void {
  if (current.text.length === 0) {
    current.text = piece
  } else {
    current.text += separator + piece
  }
}

// Split a paragraph into sentences while preserving punctuation. Rough English
// heuristic — splits after `. ! ?` followed by whitespace + capital letter.
// Documented limitation: misclassifies abbreviations like "Mr. Smith"; accepted
// for Atlas's domain (build status messages, no proper-noun abbreviations).
function splitSentences(paragraph: string): string[] {
  const parts = paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
  return parts.map(p => p.trim()).filter(p => p.length > 0)
}

// Split an over-long sentence on word boundaries. Never produces a chunk that
// breaks mid-word — a single word longer than `limit` returns as-is rather than
// being sliced (NEVER list: never split mid-word).
function splitOnWords(sentence: string, limit: number): string[] {
  if (sentence.length <= limit) return [sentence]
  const words = sentence.split(/\s+/)
  const out: string[] = []
  let buf = ''
  for (const word of words) {
    if (word.length === 0) continue
    if (buf.length === 0) {
      buf = word
      continue
    }
    if (buf.length + 1 + word.length <= limit) {
      buf += ' ' + word
    } else {
      out.push(buf)
      buf = word
    }
  }
  if (buf.length > 0) out.push(buf)
  return out
}

/**
 * Split a body into Twilio-safe chunks. Each chunk is suffixed with
 * `(part N/M)` when there is more than one chunk. Algorithm:
 *
 *  1. If the body fits in `limit`, return it unchanged.
 *  2. Split on paragraph boundaries (blank line).
 *  3. For each paragraph:
 *      - If it fits in the current chunk, append it.
 *      - Otherwise, finalize the current chunk and start a new one. If the
 *        paragraph itself is over the limit, sentence-split it.
 *      - If a single sentence exceeds the limit, soft-break on word boundaries.
 *  4. Tag each part with `(part N/M)` so the user sees ordering.
 */
export function splitForWhatsApp(text: string, limit: number = TWILIO_LIMIT): string[] {
  if (!text) return []
  if (text.length <= limit) return [text]

  // Reserve space for the suffix so the FINAL chunk including suffix still fits.
  const effectiveLimit = Math.max(50, limit - SUFFIX_RESERVE)

  const chunks: AccumulatorChunk[] = []
  const current = { text: '' }

  const paragraphs = text.split(/\n{2,}/)
  for (const para of paragraphs) {
    const trimmedPara = para.trim()
    if (!trimmedPara) continue

    // Easy case: paragraph fits if appended to the current chunk.
    const projectedLen = current.text.length === 0
      ? trimmedPara.length
      : current.text.length + 2 + trimmedPara.length // "\n\n" join
    if (projectedLen <= effectiveLimit) {
      appendToCurrent(current, trimmedPara, '\n\n')
      continue
    }

    // Doesn't fit. Flush whatever's queued.
    pushChunk(chunks, current)

    // Paragraph alone fits in a fresh chunk → just take it.
    if (trimmedPara.length <= effectiveLimit) {
      current.text = trimmedPara
      continue
    }

    // Paragraph is too long for any single chunk → sentence-split.
    const sentences = splitSentences(trimmedPara)
    for (const sentence of sentences) {
      if (sentence.length === 0) continue
      const projected = current.text.length === 0
        ? sentence.length
        : current.text.length + 1 + sentence.length // " " join
      if (projected <= effectiveLimit) {
        appendToCurrent(current, sentence, ' ')
        continue
      }
      // Sentence doesn't fit alongside what we have. Flush.
      pushChunk(chunks, current)

      if (sentence.length <= effectiveLimit) {
        current.text = sentence
        continue
      }

      // Single sentence longer than the limit — fall back to word boundaries.
      const wordChunks = splitOnWords(sentence, effectiveLimit)
      for (let i = 0; i < wordChunks.length; i++) {
        const wc = wordChunks[i]
        if (i === wordChunks.length - 1) {
          // Last word-chunk becomes the new current buffer (might absorb the
          // next sentence).
          current.text = wc
        } else {
          chunks.push({ text: wc })
        }
      }
    }
  }

  pushChunk(chunks, current)

  if (chunks.length === 0) return []
  if (chunks.length === 1) return [chunks[0].text]

  const total = chunks.length
  return chunks.map((c, i) => `${c.text}\n\n(part ${i + 1}/${total})`)
}

/** Sleep helper used between sequential WhatsApp sends to keep ordering. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const PART_SEND_DELAY_MS = 250
