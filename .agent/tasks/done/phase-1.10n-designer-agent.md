# Task: Phase 1.10n — Designer agent (7th service)

**Master plan reference:** Production-house design quality gap identified 2026-05-01. Adds the 7th agent specialized in UI/UX review.
**Context:** Builder is a generalist coder. UI tasks ship functional but uninspired code — no consistent design tokens, weak hierarchy, accessibility gaps, mobile afterthoughts. The Designer agent owns visual quality. It runs as a peer to Verifier — pre-reviews UI specs (catches missing design intent), post-reviews UI commits (catches deviations from intent).
**Estimated effort:** ~2 hours Builder time
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

Build a new Railway service `designer` (root `/designer`) that:

1. Exposes `POST /designer/review-spec` — takes a task spec, returns design feedback (verdict pass/fail + gaps)
2. Exposes `POST /designer/audit-commit` — takes a commit SHA range, audits the UI changes against design intent
3. Multi-brain: Claude (design reasoning) + GPT-4 vision (screenshot review when applicable)
4. Reads design system reference docs from Memory
5. Wired into `agent/agent-loop.sh` like Verifier — gate UI tasks before push

## Architecture

Mirrors Verifier service structure exactly. Same Dockerfile pattern (multi-stage Node 22 + entrypoint.sh clone), same Express/HTTP server, same Bearer auth.

```
designer/
├── Dockerfile
├── entrypoint.sh
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # CLI entry, server | review | audit subcommands
│   ├── server.ts          # HTTP /designer/review-spec, /designer/audit-commit, /health
│   ├── lib/
│   │   ├── env.ts
│   │   ├── supabase.ts    # multi-name fallback (V3_SUPABASE_URL etc.)
│   │   ├── memory-search.ts  # query Memory for design docs
│   │   └── audit.ts       # writes to designer_runs table
│   ├── reviewers/
│   │   ├── claude-design.ts   # Claude design review
│   │   └── gpt-vision.ts      # GPT-4o vision review (screenshot diff)
│   ├── checks/
│   │   ├── design-tokens.ts   # Tailwind tokens used (no hex literals in src/)
│   │   ├── shadcn-usage.ts    # shadcn/ui Card/Button/Input used (no raw divs for clickable)
│   │   ├── accessibility.ts   # aria-*, alt text, focus-visible, contrast
│   │   ├── mobile-responsive.ts  # @media or Tailwind responsive prefixes used
│   │   └── motion.ts          # transitions, easing on interactive elements
│   ├── prompts/
│   │   ├── spec-review.ts     # prompt for reviewing a spec markdown
│   │   └── commit-audit.ts    # prompt for auditing a commit diff
│   └── types.ts
```

## Schema

New table `designer_runs`:

```sql
CREATE TABLE public.designer_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL,
  operation text NOT NULL,        -- 'review-spec' | 'audit-commit'
  verdict text NOT NULL,           -- 'pass' | 'fail' | 'unknown'
  confidence numeric(3,2),         -- 0.00 to 1.00
  gaps jsonb DEFAULT '[]',         -- [{check, severity, description, fix}]
  ai_judgment jsonb DEFAULT '{}',  -- {claude: {verdict, reasoning, costUsd}, gptVision: {...}}
  cost_usd numeric(10,4) DEFAULT 0,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE designer_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read designer runs" ON designer_runs FOR SELECT USING (true);
CREATE INDEX idx_designer_runs_task ON designer_runs (task_id, created_at DESC);
```

## Design system reference (CRITICAL)

The Designer needs a strict design system to enforce. Add this file to repo at `.agent/design-system.md`:

```markdown
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
```

## API endpoints

### POST /designer/review-spec
Request:
```json
{ "task_id": "phase-1.10k-atlas-dashboard", "spec_markdown": "<full spec content>" }
```
Response (when fail):
```json
{
  "verdict": "fail",
  "confidence": 0.90,
  "gaps": [
    { "check": "design-tokens", "severity": "high", "description": "Spec mentions 'colors' but no specific tokens", "fix": "Specify emerald-600/slate-900 etc." },
    { "check": "accessibility", "severity": "high", "description": "No mention of focus-visible or aria-labels", "fix": "Require aria-labels on Button without text" }
  ],
  "ai_judgment": { "claude": "...", "gptVision": null },
  "cost_usd": 0.012
}
```

### POST /designer/audit-commit
Request:
```json
{ "task_id": "phase-1.10k-atlas-dashboard", "head_before": "abc123", "head_after": "def456" }
```

Designer fetches the diff (uses git via local clone), reads changed `.tsx`/`.css` files, runs static checks AND Claude review AND optionally GPT-4 vision (if a screenshot was generated by Builder).

Response same shape as review-spec.

## Static checks

`design-tokens.ts`:
```ts
// Reject hex literals in src/ components
const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g
// Allow only in tailwind.config.ts and CSS variables
```

`shadcn-usage.ts`:
```ts
// Find <div onClick=> or <span onClick=> — recommend Button
// Find onClick on non-button without role="button"
```

`accessibility.ts`:
```ts
// <button> without text content AND no aria-label
// <img> without alt prop
// <input> without associated <Label>
```

`mobile-responsive.ts`:
```ts
// File modifies a Card/Button without any sm:/md:/lg: classes → warn
// Hard-coded widths > 400px without responsive override → warn
```

`motion.ts`:
```ts
// hover: classes without transition- classes → warn
// Custom interactive without :focus-visible → fail
```

## AI review (multi-brain)

`reviewers/claude-design.ts`: Claude Sonnet reads spec or diff, evaluates against design system, returns verdict + reasoning.

`reviewers/gpt-vision.ts`: When applicable (Builder generates a screenshot), GPT-4o vision compares rendered screenshot to spec's design intent. For v0.1, this is optional — call only if `screenshot_url` present in metadata.

Verdict aggregation: 2-of-2 fail → fail. Mixed → use confidence-weighted average.

## Wire into agent-loop.sh

Add to existing Verifier gate logic — Designer is a parallel gate that fires only on UI tasks (detected by spec content or filename keywords like 'dashboard', 'page', 'component'):

```bash
# After Verifier gate succeeds, run Designer gate (UI tasks only)
if is_ui_task "$TASK_NAME"; then
  designer_response=$(curl -sS -m 60 -X POST "$DESIGNER_URL/audit-commit" \
    -H "Authorization: Bearer $DESIGNER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"task_id\":\"$TASK_NAME\",\"head_before\":\"$HEAD_BEFORE\",\"head_after\":\"$HEAD_AFTER\"}")
  designer_verdict=$(echo "$designer_response" | jq -r '.verdict')
  if [ "$designer_verdict" = "fail" ]; then
    echo "Designer blocked: queue remediation"
    queue_remediation_with_feedback "$designer_response"
    return 1
  fi
fi
```

`is_ui_task` heuristic: filename contains `dashboard|page|component|ui` OR spec content references `tsx|tailwind|shadcn`.

## Acceptance criteria

After this task ships:

1. `designer/` directory exists with full structure.
2. `cd designer && npm install && npm run build` succeeds.
3. Migration applied — `designer_runs` table exists.
4. After Railway deploy, `https://designer-production.up.railway.app/health` returns 200.
5. `POST /designer/review-spec` with a deliberately bad UI spec returns `verdict: fail` with gaps.
6. agent-loop.sh's Designer gate fires only on UI tasks.
7. `.agent/design-system.md` exists in repo.
8. Smoke test: queue a synthetic UI task with no design system reference → Designer rejects.

## Required env vars (user adds in Railway)

- `AGENT_SSH_PRIVATE_KEY` (mirrors other services)
- `GIT_REPO_URL`
- `V3_SUPABASE_URL` / `V3_SUPABASE_SECRET_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY` (for GPT-4o vision)
- `DESIGNER_API_TOKEN` — generate a new bearer token
- `MEMORY_URL` / `MEMORY_API_TOKEN` (for design system lookup)

## Out of scope

- Figma plugin integration (future)
- Auto-screenshot generation by Builder (future — needs Playwright in agent container)
- Color palette generator (use the locked palette in design-system.md)
- Brand guideline auto-extraction from existing pages

## Notes

- Designer is the LAST gate before merge — runs after Verifier passes.
- For non-UI tasks (backend, scripts, docs), Designer is skipped entirely.
- Designer can debate Claude vs GPT-4o on visual issues — quorum 1-of-2 fail = fail (more strict than other agents because design quality is binary-ish).
- Cost: ~$0.01-0.05 per UI task review. Tracked in atlas_cost_log under service='designer'.
