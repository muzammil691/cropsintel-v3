import { ChangedFile, DesignGap } from '../types'

const IMG_TAG = /<img\b([^>]*)\/?>/g
const BUTTON_OPEN = /<button\b([^>]*)>/g
const INPUT_TAG = /<input\b([^>]*)\/?>/g

function hasAlt(attrs: string): boolean {
  return /\balt\s*=/.test(attrs)
}

function hasAriaLabel(attrs: string): boolean {
  return /\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs)
}

export function checkAccessibility(files: ChangedFile[]): DesignGap[] {
  const gaps: DesignGap[] = []

  for (const file of files) {
    if (!/\.(tsx|jsx)$/.test(file.path)) continue
    if (!file.path.startsWith('src/')) continue

    const lines = file.contents.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // <img> without alt
      let m: RegExpExecArray | null
      IMG_TAG.lastIndex = 0
      while ((m = IMG_TAG.exec(line)) !== null) {
        const attrs = m[1] ?? ''
        if (!hasAlt(attrs)) {
          gaps.push({
            check: 'accessibility',
            severity: 'high',
            description: '<img> tag without alt attribute',
            fix: 'Add alt="" for decorative images or alt="meaningful description" for content images',
            file: file.path,
            line: i + 1,
          })
        }
      }

      // <button> with no text/children AND no aria-label (best-effort: same line)
      BUTTON_OPEN.lastIndex = 0
      while ((m = BUTTON_OPEN.exec(line)) !== null) {
        const attrs = m[1] ?? ''
        const afterTag = line.slice(m.index + m[0].length).trim()
        const closesImmediately = /^\s*<\/button>/.test(afterTag) || /^\s*$/.test(afterTag)
        if (closesImmediately && !hasAriaLabel(attrs)) {
          gaps.push({
            check: 'accessibility',
            severity: 'high',
            description: '<button> with no visible text and no aria-label',
            fix: 'Add aria-label="..." to icon-only buttons',
            file: file.path,
            line: i + 1,
          })
        }
      }

      // <input> without id/name + label association (best-effort)
      INPUT_TAG.lastIndex = 0
      while ((m = INPUT_TAG.exec(line)) !== null) {
        const attrs = m[1] ?? ''
        const isHidden = /\btype\s*=\s*["']hidden["']/.test(attrs)
        if (isHidden) continue
        const hasIdOrAria = /\bid\s*=/.test(attrs) || hasAriaLabel(attrs)
        if (!hasIdOrAria) {
          gaps.push({
            check: 'accessibility',
            severity: 'medium',
            description: '<input> without id or aria-label — likely missing <Label> association',
            fix: 'Pair <input id="x"> with <Label htmlFor="x"> or add aria-label',
            file: file.path,
            line: i + 1,
          })
        }
      }
    }
  }

  return gaps
}
