import { ChangedFile, DesignGap } from '../types'

const HOVER_CLASS = /\bhover:[\w[\]/.\-]+/
const TRANSITION_CLASS = /\btransition(?:-[a-z]+)?\b/
const FOCUS_VISIBLE_CLASS = /\bfocus-visible:[\w[\]/.\-]+/
const ON_CLICK_NON_BUTTON = /<(div|span|li|a)\b[^>]*\bonClick\s*=/g

export function checkMotion(files: ChangedFile[]): DesignGap[] {
  const gaps: DesignGap[] = []

  for (const file of files) {
    if (!/\.(tsx|jsx)$/.test(file.path)) continue
    if (!file.path.startsWith('src/')) continue

    const lines = file.contents.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // hover: without transition- on the same line — warn only
      if (HOVER_CLASS.test(line) && !TRANSITION_CLASS.test(line)) {
        // Check next/prev line for transition before flagging
        const window = [lines[i - 1] ?? '', line, lines[i + 1] ?? ''].join(' ')
        if (!TRANSITION_CLASS.test(window)) {
          gaps.push({
            check: 'motion',
            severity: 'low',
            description: `${file.path}:${i + 1} hover: class without transition- — abrupt state change`,
            fix: 'Add transition-colors duration-200 (or similar) for smooth state changes',
            file: file.path,
            line: i + 1,
          })
        }
      }

      // Custom interactive without focus-visible
      ON_CLICK_NON_BUTTON.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = ON_CLICK_NON_BUTTON.exec(line)) !== null) {
        // Check whole element block (best-effort: same + next 2 lines for className)
        const block = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ')
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
