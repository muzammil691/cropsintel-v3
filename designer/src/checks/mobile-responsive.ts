import { ChangedFile, DesignGap } from '../types'

const RESPONSIVE_PREFIX = /\b(?:sm|md|lg|xl|2xl):/
const HARD_PIXEL_WIDTH = /\b(?:width|min-width|max-width)\s*:\s*(\d{3,4})px/g
const TAILWIND_FIXED_WIDTH = /\bw-\[(\d{3,4})px\]/g

export function checkMobileResponsive(files: ChangedFile[]): DesignGap[] {
  const gaps: DesignGap[] = []

  for (const file of files) {
    if (!/\.(tsx|jsx|css|scss)$/.test(file.path)) continue
    if (!file.path.startsWith('src/')) continue

    // For tsx files, look for component usage missing responsive prefixes
    const referencesShadcn = /\b(Card|Button|Input|Textarea|Select|Dialog|Sheet|Badge)\b/.test(
      file.contents,
    )
    const hasResponsive = RESPONSIVE_PREFIX.test(file.contents)
    if (referencesShadcn && !hasResponsive && /\.(tsx|jsx)$/.test(file.path)) {
      gaps.push({
        check: 'mobile-responsive',
        severity: 'medium',
        description: `${file.path}: uses shadcn components but has no responsive prefixes (sm:/md:/lg:)`,
        fix: 'Add Tailwind responsive prefixes for layouts that should adapt across viewports',
        file: file.path,
      })
    }

    // Hard-coded pixel widths > 400 in CSS or Tailwind arbitrary values
    const lines = file.contents.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      let m: RegExpExecArray | null
      HARD_PIXEL_WIDTH.lastIndex = 0
      while ((m = HARD_PIXEL_WIDTH.exec(line)) !== null) {
        const px = parseInt(m[1], 10)
        if (px > 400) {
          gaps.push({
            check: 'mobile-responsive',
            severity: 'medium',
            description: `${file.path}:${i + 1} hard-coded width ${px}px will overflow on mobile (375px viewport)`,
            fix: 'Use responsive Tailwind classes (w-full sm:w-96) or rem/% units',
            file: file.path,
            line: i + 1,
          })
        }
      }
      TAILWIND_FIXED_WIDTH.lastIndex = 0
      while ((m = TAILWIND_FIXED_WIDTH.exec(line)) !== null) {
        const px = parseInt(m[1], 10)
        if (px > 400) {
          gaps.push({
            check: 'mobile-responsive',
            severity: 'medium',
            description: `${file.path}:${i + 1} fixed Tailwind width w-[${px}px] will overflow on mobile`,
            fix: 'Use w-full sm:w-[${px}px] or responsive override',
            file: file.path,
            line: i + 1,
          })
        }
      }
    }
  }

  return gaps
}
