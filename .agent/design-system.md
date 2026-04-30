# CropsIntel V3 Design System

## Color tokens (Tailwind config — NEVER use hex literals in components)
- Primary: emerald-600/700 (almonds-bonded brand)
- Neutral: slate (50-950)
- Semantic: green-600 success / amber-500 warn / red-600 error / blue-600 info
- Background: slate-50 light / slate-950 dark

## Typography
- Display: Geist Sans (400/500/700 only — never light)
- Body: same family
- Mono: Geist Mono
- Scale: text-xs / text-sm (default body) / text-base / text-lg (h3) / text-xl (h2) / text-2xl (h1) / text-3xl (page title)
- Line-height: leading-tight for headings, leading-relaxed for body

## Spacing
- Use Tailwind 4-base scale only: p-1 p-2 p-3 p-4 p-6 p-8 p-12 p-16
- Consistent gap: gap-2 (compact), gap-4 (default), gap-6 (loose)
- Card padding: p-6 default, p-4 compact

## Components (always shadcn/ui — never raw HTML for clickable)
- Card / CardHeader / CardContent / CardFooter
- Button (variant: default | outline | ghost | destructive — sizes: default | sm | lg)
- Input / Textarea / Select / Switch
- Dialog / Sheet / Popover for overlays
- Badge for status pills (variant: default | secondary | destructive | outline)
- Skeleton for loading states (REQUIRED — no spinners alone)

## States (every interactive element MUST have)
- :hover (subtle scale or color shift)
- :focus-visible (ring-2 ring-emerald-600/50)
- :disabled (opacity-50 cursor-not-allowed)
- :active (slight inset)

## Motion
- Transitions on interactive elements: transition-colors duration-200
- Hover scale: hover:scale-[1.02] for cards
- Reveal: animate-in fade-in / slide-in-from-bottom-2 duration-300

## Accessibility (WCAG AA minimum)
- All images: alt="" or descriptive
- All buttons: text content OR aria-label
- All form inputs: <Label htmlFor=... > paired
- Color contrast: text-slate-700 on white = 11:1 ✓ / text-slate-500 = 4.5:1 ✓
- Focus visible on all interactives
- Keyboard nav: tabindex 0 on custom interactives, Enter/Space handlers

## Mobile-first
- Default styles target 375px viewport
- Use Tailwind responsive prefixes: sm: md: lg:
- Bottom safe-area on mobile: pb-safe (Tailwind plugin) or pb-4 minimum
- Touch targets: min-h-[44px] on interactive elements

## Anti-patterns (REJECTED in audit)
- Hex colors in components (use tokens)
- Raw <div onClick=...> (use Button or shadcn equivalent)
- "Loading..." text alone (use Skeleton)
- Spinner without progress feedback
- Hover styles without focus-visible
- Fixed pixel widths (use rem/% or Tailwind w-* classes)
- Multiple H1 per page
- Modal without focus trap
