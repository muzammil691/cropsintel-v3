export function buildCommitAuditPrompt(args: {
  taskId: string
  diff: string
  changedFiles: { path: string; contents: string }[]
  designSystem: string
  staticGapSummary: string
}): string {
  const filesSection = args.changedFiles
    .slice(0, 15)
    .map(f => `=== ${f.path} ===\n${f.contents.slice(0, 4000)}`)
    .join('\n\n')

  return `You are the Designer agent for CropsIntel V3 — the last design quality gate before merge.

Your job: review the following commit diff and the changed UI files, and decide whether they meet the design system standards.

## Design system you MUST enforce

${args.designSystem}

## Static checks already found these gaps

${args.staticGapSummary || '(no static-check gaps found — focus on judgment-call issues)'}

## Commit diff (truncated)

${args.diff.slice(0, 8000)}

## Changed UI files (truncated)

${filesSection.slice(0, 30000)}

## What to look for

1. Hex color literals in components (use Tailwind tokens) — already partially flagged by static checks
2. Raw clickable divs/spans (use shadcn Button)
3. <img> without alt, <button> without aria-label, <input> without Label
4. Hover states without focus-visible
5. Loading states using "Loading..." text instead of Skeleton
6. Multiple H1 per page
7. Hard-coded pixel widths > 400px (mobile overflow)
8. Touch targets smaller than 44px (min-h-[44px])
9. Modals without focus trap
10. Inconsistent spacing (random p-[27px] values instead of p-6)

## Rules

- Only flag genuine issues you can quote evidence for from the diff or files above.
- If the change is non-UI (backend, migration, script), verdict "pass" with empty gaps.
- For mixed changes, judge ONLY the UI files.
- Be ruthless about accessibility and consistency, but don't nit-pick stylistic choices that are within tokens.

Respond with ONLY valid JSON (no markdown wrapper):
{
  "verdict": "pass" | "fail",
  "confidence": 0.0-1.0,
  "reasoning": "2-3 sentence assessment quoting specific lines",
  "gaps": [
    {
      "check": "design-tokens" | "shadcn-usage" | "accessibility" | "mobile-responsive" | "motion" | "typography" | "states" | "loading-states" | "spacing" | "hierarchy",
      "severity": "high" | "medium" | "low",
      "description": "specific gap with file:line if known",
      "fix": "concrete change required",
      "file": "path/to/file.tsx (if applicable)",
      "line": 0
    }
  ]
}`
}
