# Atlas Brain UI Research

**Author:** Builder agent (phase-1.10ab)
**Date:** 2026-05-01
**Purpose:** Inform the from-scratch design of `/atlas-brain`, the admin Multi-Brain debate UI. Each reference below documents what works for surfacing multi-LLM debates, what to borrow for Atlas Brain, and what NOT to copy.

This document **must** be committed in its own commit before any TSX work in this task. Findings drive the layout, the per-author card system, the streaming-debate motion, and the cost-meter footer.

---

## Goals the UI must serve

1. **Brain nodes are first-class entities, not tickets.** Each node represents a persistent, scored facet of the V3 system (e.g. "Atlas conductor quality", "RLS information walls"). The list rail must feel like an inventory, not an inbox.
2. **Debates are conversations between authors, not opaque AI calls.** Four voices (Claude / GPT-4o / Gemini / Consensus) need their own visual identity, color, and rhythm. The user must instantly know who said what.
3. **Streaming opinions are the primary motion.** Debates take 10–30 s. The user must never wonder "is this frozen?" — opinions arrive in cards, one by one, with a thinking indicator.
4. **Score is the always-visible truth.** Every node has a 0..100 score. The badge is the headline; the sparkline is the receipt; the latest delta is the news.
5. **Cost is ambient.** A footer shows debate cost + monthly burn against the $400 cap. Never modal, never demanding — but always one glance away.

---

## 1. Cursor IDE — Composer pane

**What works:** Cursor's composer shows multi-step agent runs as a vertically threaded conversation, with each tool call collapsing into a chip the user can expand to inspect a structured diff. Critically, when Cursor presents alternative model outputs (e.g. an "apply this version" choice), they're shown as **side-by-side full cards**, not as inline diffs against each other — the user judges each draft on its own terms before picking. The composer also surfaces per-author colored gutters: Claude tasks render with a different vertical stripe than GPT-4o tasks, so the eye groups by author at a glance.

**Borrow for Atlas Brain:**
- **Per-author colored vertical gutter** on each `DebateMessageCard` (Claude purple-600, GPT emerald-600, Gemini blue-600, Consensus amber-500). Lets the user group the three opinions visually before reading them.
- **Full cards per opinion** — never collapse opinions into a side-by-side diff. The whole point of Multi-Brain is the divergent reasoning; force the reader to encounter each in full.
- **Compact density.** Cursor uses ~13px font, 4–8px rhythm. Atlas Brain detail pane should match — admins read this; admins want density.

**Do NOT copy:**
- Cursor's "Accept this version, reject that" pattern. In Atlas Brain we never pick a winner — Consensus does, and the score reflects it. Don't add per-opinion accept/reject controls.

---

## 2. OpenAI Playground — Side-by-Side Compare

**What works:** Playground's compare mode renders model outputs in **parallel columns**, each with its own model selector header, token count footer, and continuous-scrolling content area. The layout makes it trivial to skim three responses to the same prompt and find divergence. Critically, columns are equal width, equal vertical scroll — no model gets visual priority.

**Borrow for Atlas Brain:**
- On wide screens (≥lg), allow an **optional 3-column "compare view"** for the three opinion cards (Claude / GPT / Gemini), with Consensus always rendered as a full-width card below. This makes divergence the first thing the eye sees.
- **Per-card footer with cost + tokens + duration.** Playground's "127 prompt tokens, 234 completion tokens" footer is a great pattern — small, gray, never stealing focus.

**Do NOT copy:**
- Playground's "lock all prompts in sync" controls — we never edit opinions; they are immutable artifacts. No per-card editing UI.
- Playground's empty-state which is a textarea inviting input. In Atlas Brain the empty state is "no debates yet — click Run Multi-Brain to begin," not an editable input box.

---

## 3. Anthropic Workbench — Model selection + diff

**What works:** Workbench's model picker is a **discreet dropdown in the top-right of the canvas**, not the center of the UI. The conversation is the focus; model is metadata. When you re-run a prompt with a different model, the new run appears below the previous one — a vertical conversation history that lets you scroll back through the lineage. Subtle, never disorienting.

**Borrow for Atlas Brain:**
- **Thread history is vertical and chronological,** not collapsed-by-default. When Run Multi-Brain creates a new thread, push it on top with a date stamp, but keep older threads scrollable below.
- **Model identity in the message header, not as a screaming label.** Use a small colored dot + name ("● Claude Sonnet 4.5"), not a big badge.

**Do NOT copy:**
- Workbench's heavy "system prompt" preamble. In Atlas Brain the user prompt is short and node context is implicit (the node label + description are the system prompt for the edge function). Don't expose the assembled system prompt to the user — it's noise.

---

## 4. Replit AI Modify — Agent reasoning panel

**What works:** Replit's AI Modify shows the agent's reasoning trail as **streaming text in a side panel**, with each step prefixed by a small icon (search 🔍, edit ✏️, run ▶️). The panel autoscrolls but the user can grab and freeze it. The autoscroll resumes when the user scrolls back to bottom — a pattern borrowed from terminal apps.

**Borrow for Atlas Brain:**
- **Autoscroll-with-grab semantics** for the streaming debate. While SSE events arrive, the thread panel autoscrolls to bottom. If the user scrolls up, freeze. When they scroll back to bottom, resume.
- **Streaming "Atlas is thinking…" indicator with model emojis lighting up one-by-one** as each opinion arrives — a Replit-style status row, not a spinner.

**Do NOT copy:**
- Replit's animated typing cursor on every character. The card for an opinion appears all-at-once when the SSE event arrives — the streaming happens at the **opinion granularity**, not the character granularity. Animating per-character would feel fake (the cards are buffered until model completion).

---

## 5. Linear — AI suggestions

**What works:** Linear's AI features (auto-summary, smart titling) are extremely **quiet**. They appear as ghost text or a small badge — never modal, never blocking. The user can ignore them entirely without any "are you sure?" friction. The AI is a tool, not an event.

**Borrow for Atlas Brain:**
- **Score-delta badges are quiet.** When Consensus updates a score from 70 → 75, the badge animates with a `▲ +5` micro-indicator that fades after 5s — Linear-style, never demanding.
- **No "AI is processing" modal blockers.** The Run Multi-Brain dialog opens, the user submits, the dialog closes immediately, and the streaming happens in the existing detail pane. The user can navigate to a different node mid-debate (the debate continues server-side and the result lands when they come back).

**Do NOT copy:**
- Linear's "AI badge" decoration that puts a sparkle icon on every AI-touched field. Atlas Brain is *all* AI — sparkle decorations would be noise. The colored gutter is enough author-identity.

---

## 6. Notion AI — Inline reasoning + accept/reject

**What works:** Notion AI surfaces its reasoning as a **collapsible "Why?" section** below each AI-generated block. The reasoning is opt-in — collapsed by default, expandable on click. This keeps the surface dense for power users while staying explainable.

**Borrow for Atlas Brain:**
- **Per-opinion "Why this score?" expandable section.** The Consensus card shows its verdict; clicking "Why?" expands the score reasoning + a comparison of the three opinions' positions.
- **Manual score adjust dialog** with a required `reason` textarea — Notion-style insistence on rationale before mutation.

**Do NOT copy:**
- Notion's accept/reject buttons. In Atlas Brain, opinions are not rejected — they're just *one of three*. Consensus does the rejection implicitly. Don't replicate Notion's "trash this draft" pattern.

---

## 7. Vercel v0 — Multi-iteration generation log

**What works:** v0 keeps a **vertical history of iterations** down the left rail — every generation, every refinement. Clicking an iteration loads it into the canvas. The history doubles as audit log: the user can always go back to a prior version.

**Borrow for Atlas Brain:**
- **Sparkline of `brain_node_history`** as the left edge of the detail pane — scrubbable, click-through to specific historical debates.
- **Each historical thread is collapsable.** The current thread is open; older threads are titled rows ("Debate 2026-04-30 — score 65 → 70") that expand on click.

**Do NOT copy:**
- v0's "fork from this iteration" button — Atlas Brain doesn't fork debates; Multi-Brain is single-shot per thread. Don't introduce branching that doesn't match the data model.

---

## Synthesis: layout decisions locked

- **Two-pane on desktop** (rail left, detail right), **tabs on mobile** (Nodes / Detail / Debate).
- **Score badge:** color-coded (green-600 ≥80, amber-500 50–79, red-500 <50, gray no score). Small but high-contrast.
- **Author cards:** colored vertical gutter + small dot+name header. Claude purple-600, GPT emerald-600, Gemini blue-600, Consensus amber-500.
- **Streaming:** opinion-granularity (not character). Status row of three model emojis lights up as each arrives.
- **Sparkline:** 30-day default, recharts line, no axes — pure trend strip.
- **Cost footer:** Today / Month / Cap, last-debate cost, with a thin progress bar like the existing `CostMeter`.
- **Reduce-motion:** all card-arrival animations are gated on `prefers-reduced-motion: no-preference`.
- **Reason gating:** every manual score adjust requires a non-empty `reason` (logged to `brain_node_history`).
