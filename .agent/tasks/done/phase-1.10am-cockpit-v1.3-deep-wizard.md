---
phase: 1.10am
title: Cockpit v1.3 — Deep multi-turn wizard (conversational refinement until 100% clarity)
status: planned
gate: in-progress count <= 2 AND phase 1.10al shipped
order: 3-of-4 cockpit upgrade bundle
estimated_builder_minutes: 25
estimated_cost_usd: 4
master_plan_section: 11.7
---

# Phase 1.10am — Cockpit v1.3: Deep multi-turn wizard

## Why this exists

Today's wizard (shipped in 1.10aj) asks 3-7 multi-choice questions in a single pass, then generates a spec. That's "shallow refinement" — fine for simple phases, weak for complex ones.

User wants **deep refinement**: Atlas asks, user answers, Atlas digests the answer and asks better follow-up questions, repeat until clarity is 100%. Like a senior engineer interviewing you about a feature: each answer narrows the next question.

Concretely, today's flow on Phase 1.3 (auth) might ask:
- Q1: "What login methods?" [email / WhatsApp / both / OAuth]
- User picks "both"
- Q2: "Is OTP required for verified tier?" [yes / no]
- User picks "yes"
- ... 5 more single-shot questions, then generates spec.

Deep wizard flow:
- Q1: "What login methods?" [email / WhatsApp / both]
- User picks "both"
- Q2 (digested from Q1): "For the WhatsApp flow, when a user enters their number, what happens if it doesn't match an existing V2 user record?" [auto-create V1 / require admin invite / send magic link to email tied to phone]
- User picks "send magic link to email tied to phone"
- Q3 (digested from Q2): "When the magic link arrives and they click it, do you want them to set a password immediately, or use OTP-only forever?" [set password / OTP only / their choice]
- ...continues until Atlas confirms it has every detail it needs

Each question is generated AFTER seeing previous answers, not pre-baked. The wizard ends when Atlas itself decides "I have 100% clarity" — not at a fixed question count.

## Foundation-first check

- ✅ `wizard-engine.ts` exists (1.10aj) with `proposeQuestions` and `finalizeSpec`.
- ✅ Repo reader exists (1.10ak) — Atlas knows real codebase facts.
- ✅ Idea file exists (1.10al) — Atlas reasons from canonical vision.
- ❓ Today's wizard is single-pass — needs refactoring to multi-turn loop.
- ❓ No "100% clarity" detector — net-new logic.

## What ships

### 1. Multi-turn wizard engine

Refactor `atlas/src/lib/wizard-engine.ts`:

```typescript
type WizardTurn = {
  question: string
  options: string[]
  allow_freeform: boolean
  rationale: string  // why Atlas is asking this
}

type WizardState = {
  phase_id: string
  history: { question: string; answer: string }[]
  total_turns: number
  is_complete: boolean
  clarity_score: number  // 0-100
  current_turn?: WizardTurn
}

async function nextTurn(state: WizardState): Promise<WizardTurn | { done: true; spec_draft: string }> {
  const ideaFile = await getFileContent('.agent/idea.md')
  const repoIndex = await getRepoIndex()
  const masterPlan = await getMasterPlanForPhase(state.phase_id)
  
  const prompt = `
You are conducting a deep planning interview for ${state.phase_id}.

Product vision:
${ideaFile}

Master plan section for this phase:
${masterPlan}

Repo facts:
${summarizeRepoForPhase(repoIndex, state.phase_id)}

Conversation so far:
${state.history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n\n')}

Your job: decide whether you have 100% clarity to write a spec, or if you need one more question.

Output JSON in ONE of two shapes:

If you need more info:
{
  "kind": "question",
  "rationale": "<one sentence why you need this answer>",
  "question": "<question text>",
  "options": ["<option 1>", "<option 2>", ...],
  "allow_freeform": true,
  "current_clarity": <0-100, your honest estimate of how clear the spec would be without this answer>
}

If you have enough to write a complete spec:
{
  "kind": "complete",
  "current_clarity": 100,
  "summary_of_decisions": "<2-3 sentence recap of what was decided across turns>",
  "spec_draft": "<full spec markdown ready to commit>"
}

Rules:
- Stop asking questions once clarity ≥ 90 AND you can write the spec without ambiguity.
- Don't ask things the idea file or repo already answers.
- Don't ask >12 questions total — if at turn 12 still under 90 clarity, write the spec anyway with documented assumptions.
- Each question must be UNIQUE — never re-ask something already in history.
- Each question must DEPEND on previous answers (multi-turn means follow-ups, not parallel options).
`
  return await callClaude(prompt)
}
```

### 2. Wizard UI updates

Extend `src/components/atlas-plan/PhaseWizard.tsx`:

- Show conversation history (Q/A bubbles, like a chat).
- After each answer, animate "Atlas is thinking..." for ~2s while next turn loads.
- Show clarity progress bar at top: "Clarity: 67% — 3 more questions likely."
- "Done" appears when Atlas signals completion. Click → generates spec preview.
- Spec preview shows full markdown with edit button — user can tweak before saving.
- "Save & Add to Follow list" button moves spec to `.agent/specs/` and marks phase status `follow`.

### 3. Persistence — wizard state in Supabase

If user closes the modal mid-wizard, state should persist. New table:

```sql
CREATE TABLE IF NOT EXISTS public.wizard_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id        text        NOT NULL,
  state           jsonb       NOT NULL,  -- WizardState
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  created_by      text                   -- admin id or session
);

CREATE INDEX idx_wizard_sessions_phase ON public.wizard_sessions(phase_id, updated_at DESC);
ALTER TABLE public.wizard_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wizard_sessions_service" ON public.wizard_sessions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
```

When user reopens cockpit and clicks Add/Modify on a phase, check for an in-progress wizard session and offer to resume.

### 4. New API endpoints

- `POST /atlas/wizard/start` — body: `{ phase_id }` → returns first turn.
- `POST /atlas/wizard/answer` — body: `{ session_id, answer }` → returns next turn OR completion.
- `GET /atlas/wizard/session/:id` — returns full state for resume.
- `DELETE /atlas/wizard/session/:id` — abandon session.

### 5. Tests

`e2e/deep-wizard.spec.ts`:

- (a) Start wizard for Phase 1.3 → assert first question references idea file content (e.g. "verified buyer" or "Gulf").
- (b) Answer Q1 → assert Q2 is different and depends on Q1 answer.
- (c) Run wizard for ~5 turns → assert clarity_score increases monotonically.
- (d) Wizard reaches `kind: "complete"` → assert spec_draft is valid markdown with required sections.
- (e) Close modal mid-wizard, reopen → assert "Resume?" prompt appears.
- (f) Hit 12 turns without 100 clarity → assert spec written anyway with `## Documented assumptions` section.

## Acceptance criteria

- Wizard is multi-turn — each question depends on previous answers.
- Clarity progress bar visible to user.
- Wizard auto-completes when Atlas signals 100% clarity.
- Session persistence works (close + resume).
- Spec preview is editable before save.
- 6 e2e tests pass.
- Spec lands in `done/`.

## Out of scope

- Voice answers (text + multi-choice only for v1.3).
- Wizard branching (linear conversation only).
- Multi-user collaborative wizard (single user at a time).
- Wizard for retrospective specs ("explain what we just shipped" — different feature).

## Realistic time estimate

- Wizard engine refactor: ~8 min
- UI updates (chat-style modal): ~6 min
- Supabase migration + persistence: ~3 min
- API endpoints: ~3 min
- Tests: ~5 min
- **Builder total: ~25 min**

## Dependencies

- 1.10ak shipped (repo reader)
- 1.10al shipped (idea file)
- 1.10aj shipped (cockpit base)
