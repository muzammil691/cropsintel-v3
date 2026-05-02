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

// Scan forward from a `<button ...>` opening to detect visible content before
// the matching `</button>`. Visible content = any character that is not
// whitespace AND not enclosed by another JSX tag's brackets.
//
// The previous heuristic flagged any multi-line button as "icon-only" because
// it tested `/^\s*$/.test(afterTag)` — that fires for every button whose
// closing `>` happens to be the last character on its line. False-positive
// rate was effectively 100% on this codebase.
function buttonHasVisibleContent(lines: string[], startIdx: number, afterTag: string): boolean {
  // Walk content from `afterTag` forward, joining up to 15 lines or until we
  // see `</button>`. We track JSX tag depth so that text inside nested tags
  // (e.g. <span>Click me</span>) still counts as visible content of the button.
  let buf = afterTag
  for (let j = startIdx + 1; j < Math.min(lines.length, startIdx + 16); j++) {
    if (/<\/button>/.test(buf)) break
    buf += ' ' + lines[j]
  }
  const beforeClose = buf.split(/<\/button>/)[0] ?? buf

  // Strip JSX tags but KEEP their text contents, then check what remains.
  // - <Icon /> and <Icon ... /> become empty string (self-closing, no children)
  // - <Foo>bar</Foo> keeps "bar"
  const withoutSelfClosing = beforeClose.replace(/<[a-zA-Z][^>]*\/>/g, '')
  // For paired tags, drop the open and close markers; keep inner content.
  const withoutPairedTags = withoutSelfClosing.replace(/<\/?[a-zA-Z][^>]*>/g, '')

  // JSX expression bodies like {label} or {busy ? 'A' : 'B'} are visible
  // content too — the button renders whatever they evaluate to.
  // Simple heuristic: if there's a `{...}` expression with non-whitespace
  // inside, treat it as visible content.
  const hasJsxExpr = /\{[^}]*\S[^}]*\}/.test(withoutPairedTags)

  // Plain text content (anything that isn't whitespace and isn't a JSX brace).
  const textOnly = withoutPairedTags.replace(/\{[^}]*\}/g, '').trim()

  return hasJsxExpr || textOnly.length > 0
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

      // <button> with no visible content AND no aria-label.
      // We now look forward through up to 15 lines for the matching </button>
      // and check whether the button has visible text content (or a JSX
      // expression that would render as text). Only flag when neither exists
      // AND there is no aria-label / aria-labelledby on the opening tag.
      BUTTON_OPEN.lastIndex = 0
      while ((m = BUTTON_OPEN.exec(line)) !== null) {
        const attrs = m[1] ?? ''
        if (hasAriaLabel(attrs)) continue
        const afterTag = line.slice(m.index + m[0].length)
        if (!buttonHasVisibleContent(lines, i, afterTag)) {
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
