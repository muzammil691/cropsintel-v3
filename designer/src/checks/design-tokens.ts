import { ChangedFile, DesignGap } from '../types'

const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g
const ALLOWED_FILES = /tailwind\.config|index\.css|globals\.css|theme\.css|design-system|\.svg$/i

export function checkDesignTokens(files: ChangedFile[]): DesignGap[] {
  const gaps: DesignGap[] = []

  for (const file of files) {
    if (!file.path.startsWith('src/')) continue
    if (ALLOWED_FILES.test(file.path)) continue
    if (!/\.(tsx|jsx|ts|js)$/.test(file.path)) continue

    const lines = file.contents.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Skip comments
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue

      // Strip strings that look like CSS variables or import paths to reduce false positives
      const stripped = line.replace(/var\(--[^)]+\)/g, '').replace(/url\([^)]+\)/g, '')

      const matches = stripped.match(HEX_PATTERN)
      if (matches && matches.length > 0) {
        for (const hex of matches) {
          gaps.push({
            check: 'design-tokens',
            severity: 'high',
            description: `Hex literal "${hex}" used in component (use Tailwind tokens instead)`,
            fix: `Replace ${hex} with a Tailwind token (emerald-600, slate-900, etc.) defined in tailwind.config`,
            file: file.path,
            line: i + 1,
          })
        }
      }
    }
  }

  return gaps
}
