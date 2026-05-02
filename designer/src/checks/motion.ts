import { ChangedFile, DesignGap } from '../types'

const HOVER_CLASS = /\bhover:[\w[\]/.\-]+/
const TRANSITION_CLASS = /\btransition(?:-[a-z]+)?\b/
const FOCUS_VISIBLE_CLASS = /\bfocus-visible:[\w[\]/.\-]+/
const ON_CLICK_NON_BUTTON = /<(div|span|li|a)\b[^>]*\bonClick\s*=/g

// Collect every line of the file that defines or extends a const string
// containing class names, then check whether ANY of those constants carry a
// transition-* utility. If yes, hover: classes that compose those constants
// via cn(...) are already covered and shouldn't be flagged.
//
// This is the cheap fix for the false-positive wave: the audit kept flagging
// className={cn(BTN, '... hover:...')} as missing transitions because the
// 3-line window around the hover line didn't see `const BTN = '... transition-colors duration-200'`
// declared 50 lines above.
function fileHasTransitionConstant(file: { contents: string }): boolean {
  // Match any line defining a const with a string literal containing transition-*.
  // Patterns covered:
  //   const BTN = '... transition-colors ...'
  //   const buttonFocus = `transition-colors duration-200 ...`
  //   const base = "... transition-all ..."
  // Multi-line const declarations: scan a 5-line window after `const NAME =`.
  const lines = file.contents.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(?:export\s+)?const\s+[A-Za-z_]\w*\s*=/.test(lines[i])) continue
    const window = lines.slice(i, Math.min(lines.length, i + 6)).join(' ')
    if (TRANSITION_CLASS.test(window)) return true
  }
  return false
}

export function checkMotion(files: ChangedFile[]): DesignGap[] {
  const gaps: DesignGap[] = []

  for (const file of files) {
    if (!/\.(tsx|jsx)$/.test(file.path)) continue
    if (!file.path.startsWith('src/')) continue

    const lines = file.contents.split('\n')
    const fileHasTransitionConst = fileHasTransitionConstant(file)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (HOVER_CLASS.test(line) && !TRANSITION_CLASS.test(line)) {
        // Wider window: scan up to 6 lines on each side. JSX className
        // expressions often span multiple lines, especially with cn() and
        // ternaries. A 13-line window covers virtually every realistic case
        // without crossing into unrelated elements.
        const winStart = Math.max(0, i - 6)
        const winEnd = Math.min(lines.length, i + 7)
        const window = lines.slice(winStart, winEnd).join(' ')

        if (TRANSITION_CLASS.test(window)) continue

        // If the file declares a const string that contains a transition-*
        // utility (e.g. const BTN = '... transition-colors duration-200'),
        // assume any cn(BTN, '...hover:...') usage inherits the transition.
        // This is a deliberate over-approximation: it accepts a few cases
        // where the const isn't actually composed onto the hover'd element,
        // but eliminates the entire class of recurring false positives the
        // audit kept producing.
        if (fileHasTransitionConst && /\bcn\s*\(/.test(window)) continue

        gaps.push({
          check: 'motion',
          severity: 'low',
          description: `${file.path}:${i + 1} hover: class without transition- — abrupt state change`,
          fix: 'Add transition-colors duration-200 (or similar) for smooth state changes',
          file: file.path,
          line: i + 1,
        })
      }

      // Custom interactive without focus-visible
      ON_CLICK_NON_BUTTON.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = ON_CLICK_NON_BUTTON.exec(line)) !== null) {
        // Wider window for focus-visible too — same reasoning.
        const winStart = Math.max(0, i - 2)
        const winEnd = Math.min(lines.length, i + 6)
        const block = lines.slice(winStart, winEnd).join(' ')
        if (!FOCUS_VISIBLE_CLASS.test(block)) {
          gaps.push({
            check: 'motion',
            severity: 'high',
            description: `${file.path}:${i + 1} <${m[1]} onClick> without focus-visible — keyboard users cannot see focus`,
            fix: 'Add focus-visible:ring-2 focus-visible:ring-emerald-600/50 (or use shadcn Button)',
            file: file.path,
            line: i + 1,
          })
        }
      }
    }
  }

  return gaps
}
