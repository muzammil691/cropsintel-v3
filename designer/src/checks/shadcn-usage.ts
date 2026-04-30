import { ChangedFile, DesignGap } from '../types'

const RAW_CLICKABLE_DIV = /<(div|span)[^>]*\bonClick\s*=/g
const ROLE_BUTTON_PRESENT = /role\s*=\s*["']button["']/

export function checkShadcnUsage(files: ChangedFile[]): DesignGap[] {
  const gaps: DesignGap[] = []

  for (const file of files) {
    if (!/\.(tsx|jsx)$/.test(file.path)) continue
    if (!file.path.startsWith('src/')) continue

    const lines = file.contents.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      RAW_CLICKABLE_DIV.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = RAW_CLICKABLE_DIV.exec(line)) !== null) {
        const tag = match[1]
        // Allow if role="button" is on the same element (best-effort: same line)
        if (ROLE_BUTTON_PRESENT.test(line)) continue

        gaps.push({
          check: 'shadcn-usage',
          severity: 'high',
          description: `<${tag} onClick=...> without role="button" — use shadcn Button instead`,
          fix: `Replace <${tag} onClick> with <Button variant="ghost"> from @/components/ui/button, or add role="button" + keyboard handler`,
          file: file.path,
          line: i + 1,
        })
      }
    }
  }

  return gaps
}
