# Atlas Dashboard UI Research

**Author:** Builder agent (phase-1.10w)
**Date:** 2026-05-01
**Purpose:** Inform from-scratch rebuild of the Atlas conductor dashboard. Each reference below documents what works, what to borrow for Atlas, and what NOT to copy.

This document **must** be committed before any TSX in this task. The findings drive every layout, motion, and density choice in the rebuild.

---

## Goals the rebuild must serve

1. **Conversation as the spine.** Voice + text chat is the primary interaction; the panel must never be visually subordinated to status or artifacts.
2. **Artifacts as conversation peers.** Pending spec drafts, designer-audit failures, and open forks are the ways Atlas asks the user for explicit decisions — they need first-class screen real estate, not buried in tabs.
3. **Live status as ambient context.** Queue depth, costs, verifier pass rate are glanceable; they should never demand attention or dominate the field of view.
4. **Trustable controls.** Trust mode, voice toggle, live mode, and wizards are all "I'm changing how Atlas behaves" controls — they belong in a single header strip, not scattered.

---

## 1. Cursor IDE — Composer pane

**What works:** The composer pane lives to the right of the editor. Tool calls expand inline as collapsible diffs ("file X changed, +12/-3 lines") with explicit Accept / Reject gates per file. The conversation is dense: human turns are short, AI turns include the chunked diff, no unnecessary preamble. There is no separate "status" panel — the editor itself is the status.

**Borrow for Atlas:**
- **Tool-call chips that expand to a structured diff,** not a JSON dump. Our `ToolChip` already does the JSON dump; for v2 it should render `args.thread_id`, `args.file`, etc. as a small key-value table when the chip is expanded.
- **Per-action approval gates inside the message bubble.** When Atlas proposes a spec or a fork, the Accept / Queue / Drop or Choose A / Choose B controls live next to the proposal — not in a separate pane the user has to discover.
- **Density.** Cursor uses ~13px font, 4–8px vertical rhythm. Our chat is closer to 14–16px and 8–12px rhythm — fine for a customer-facing dashboard, but for a conductor pane we can compress slightly.

**Do NOT copy:**
- Cursor surfaces its agent's reasoning inline. For Atlas, reasoning belongs in conversation; raw tool output belongs in collapsed chips. Don't surface multi-paragraph chain-of-thought in the main bubble.
- Cursor has no notion of long-running background work or queues — Atlas does. We need a status surface; Cursor does not.

---

## 2. Claude.ai — Chat with artifacts

**What works:** Claude.ai uses a two-pane split: chat on the left (~40%), an "artifact" panel on the right (~60%). The artifact (a doc, code, diagram) is a peer of the conversation — both can be edited, both update in response to chat. When there is no artifact, the chat takes the whole width. The artifact panel has its own header, can be collapsed, and supports versions.

**Borrow for Atlas:**
- **Two-pane discipline.** The conversation must collapse gracefully when the artifact pane is empty (no pending specs / no audits / no forks). We will hide the artifacts pane when empty on tablet (768–1280) and let chat take 2/3 on desktop instead of forcing 1/3.
- **Artifact actions are typed.** "View / Queue / Drop" for a pending spec, "Remediate" for a design audit, "Approve A / Approve B" for a fork. These are explicit verbs that match the underlying state machine, not generic "OK / Cancel".
- **Versioning hint.** When a spec draft has been edited or replaces a prior version, surface a "v2" or "edited" hint inline. Future-proofing for when 1.10r ships iterative draft revisions.

**Do NOT copy:**
- Claude.ai's artifact panel is one artifact at a time. Atlas frequently has multiple pending artifacts (a draft + an audit + an open fork) — we need a *list* of artifact cards, each collapsible, not a single big panel.
- Claude.ai's artifact panel can take 60% of the screen. Atlas's status pane is also load-bearing, so artifacts get the *middle* third on desktop, not 60%.

---

## 3. Linear — AI integration ("Linear AI" / "Asks")

**What works:** Linear's AI is **invisible until invoked**. Suggestions surface as small inline chips ("Linear AI suggests this might be a duplicate of LIN-1234") rather than pulling the user out of their flow. The AI proposes changes; the human accepts, edits, or ignores. The AI never blocks the workflow.

**Borrow for Atlas:**
- **Status pane should be ambient, not loud.** No big card titles in ALL CAPS, no animated pulsing on routine state changes. Use `text-muted-foreground` for labels, monospace tabular nums for counters. Pulse only on alerting state (failed > 0, budget > 90%).
- **Quietly typed icons over noisy badges.** Use a single dot color (green/amber/red) per row instead of full pill badges for routine state.
- **Don't pop a modal for routine acks.** Wizards (open phase, approve ADR) live in the header bar; they don't take over the screen.

**Do NOT copy:**
- Linear AI is too quiet for our use case — Atlas frequently *needs* user attention (open fork, design audit fail). Atlas artifacts cards must have a visible state, not be hidden in a side menu.

---

## 4. GitHub Copilot Workspace

**What works:** Copilot Workspace structures every task as **Specification → Plan → Implementation** with explicit progress gates between phases. Each gate lets the user edit before proceeding. The pane layout is three vertical columns matching the three phases. Hovering a plan step reveals the affected files; clicking jumps to the implementation diff.

**Borrow for Atlas:**
- **Three-pane parity.** Our layout maps cleanly: Conversation (where decisions get made) → Active Artifacts (the proposals waiting for user) → Live Status (what's currently running). Each pane is independently scrollable.
- **Explicit progress gates.** Pending spec card has 3 buttons (View / Queue / Drop) — equivalent to Copilot's "edit / approve / reject" gate. The verb on the button must match what happens when clicked; no "Submit" buttons that do different things in different contexts.
- **Hover-to-link.** When a chat message references "phase-1.10r", hovering or clicking should highlight the matching artifact card. (Phase 2 — out of scope here, but design tokens should support a `data-anchor` hook.)

**Do NOT copy:**
- Copilot's three vertical columns are equal width; ours are 2:1:1 because conversation is the primary surface, not equal to status.
- Copilot displays a long chain-of-thought; our chat hides reasoning behind tool chips. Don't import their verbosity.

---

## 5. Devin (cognition.ai screenshots)

**What works:** Devin's UI is built around a **long-running task feed**. Tool calls render as collapsible event log entries (timestamp + tool name + summary). The user can scrub the timeline to inspect any past tool call without leaving the chat. The right pane shows the live working file or browser screenshot.

**Borrow for Atlas:**
- **Recent ships timeline.** A vertical timeline (newest at top) with timestamp, verdict icon (✓/⚠/✗), and a one-line summary. Each entry collapsible to reveal full commit message or verifier output. We have this data in `RecentShips` already; rebuild as a denser timeline component.
- **Tool call event log.** When Atlas dispatches a phase / opens a question / writes a memory chunk, surface it as a log line in the recent-ships timeline alongside commits. This makes "what is Atlas doing right now?" visible without opening live mode.
- **State icons over text labels.** ✓ / ⚠ / ✗ / ⏳ glyphs are faster to scan than "passed / warned / failed / running" text.

**Do NOT copy:**
- Devin's UI feels like a CI log — long, dense, narrow. Atlas's primary user is the conductor (the human deciding direction), not someone debugging a build. Don't make the user scroll through 200 events to find the one decision they need to make.
- Devin's right pane is a live browser/editor screenshot — we don't have one and shouldn't fake one.

---

## 6. Replit Agent

**What works:** Replit's Agent uses a tri-pane (chat | code | preview) on desktop with strong mobile fallback to a single-tab view defaulting to chat. The tab order on mobile (Chat / Files / Preview) matches the priority order. Voice input is a dedicated FAB; tapping mid-conversation never disrupts the layout.

**Borrow for Atlas:**
- **Mobile = single tab, chat default.** Bottom-tab nav: Chat (default) / Artifacts / Status. Voice and live-mode are FABs in the bottom-right, never in the tab bar.
- **Tablet = two-column.** 768–1280 px shows chat + artifacts; status moves to a slide-over drawer accessible from the header.
- **Desktop = three-column.** ≥1280 px shows all three panes simultaneously with a 2:1:1 ratio.

**Do NOT copy:**
- Replit's preview is interactive; ours is read-only status. Don't try to make the status pane editable.

---

## 7. Vercel v0

**What works:** v0 has three things: chat (left), generation log (middle, collapsible), preview iframe (right). The generation log shows tool calls as expandable rows: name, duration, output. The user spends most of their attention on chat + preview; the generation log is reference material.

**Borrow for Atlas:**
- **Tool calls collapsed by default.** Don't auto-expand every tool chip. Show name + duration; user clicks to expand args + result. (Our current `ToolChip` already does this — keep it.)
- **Cost shown contextually.** v0 shows token cost on hover in the generation log, not as a primary KPI. Atlas should keep cost as a single header KPI ("Today: $X.XX") plus a hover detail breakdown by provider, rather than four KPI cards.

**Do NOT copy:**
- v0 generates UI — its preview is a real artifact. Atlas's "preview" would be the status pane, which is already a separate column. Don't try to inline a status preview into chat.

---

## 8. Plaud / Granola — Voice-first note-taking

**What works:** Granola treats the audio recording as the source-of-truth and the transcript as a **derivative view**. Voice mode has its own dedicated full-screen mode with a giant waveform; the transcript scrolls below in real time. Exiting voice mode brings you back to the chat with the transcript appended.

**Borrow for Atlas:**
- **Live mode (1.10u) is full-screen, not inline.** Already implemented as a slide-over from the right — keep this. Voice replay in chat bubbles is small and unobtrusive (already implemented in `AudioPlayer`).
- **Big visible waveform during recording.** When STT mic is active, show a live waveform bar inline above the compose bar (we have `WaveformVisualizer` — wire it to `MicButton` recording state).
- **Transcript review before send.** Granola lets you edit the transcript before saving it. Our `MicButton` → `handleTranscript` already preserves the review gate (transcript appends to input; user reviews + edits + presses send). Don't auto-send.

**Do NOT copy:**
- Granola is built around long recordings (meetings, calls). Our voice input is short turns (~10 s). Don't build session-management UI; just record → transcribe → append → send.

---

## Synthesis: Atlas-specific design tokens

Translating the above into concrete rules for the rebuild:

| Concern | Decision |
|---|---|
| Pane ratio (≥1280 px) | Chat 50%, Artifacts 25%, Status 25% (`grid-cols-[2fr_1fr_1fr]`) |
| Pane ratio (768–1279 px) | Chat 60%, Artifacts 40%; Status in slide-over from header button |
| Pane behavior (<768 px) | Bottom tab bar (Chat / Artifacts / Status); FABs for voice + live mode |
| Empty artifact pane | Render compact "All clear" placeholder (1 line); don't reserve full column width on tablet |
| Tool call chips | Collapsed by default; show name + provider; click to expand args/result |
| Tool call args display | Key-value table for known shapes; JSON pretty-print fallback |
| Recent ships | Vertical timeline, newest top, ✓/⚠/✗/⏳ glyphs, collapsible details |
| Cost display | Single line "$X.XX today / $Y.YY MTD"; hover/click for provider breakdown |
| Verifier pass rate | Sparkline (last 30 runs), no axis labels, % overlay top-right |
| Status counters | Tabular-nums monospace, label above value, no card chrome unless >= 4 metrics in a row |
| Trust mode badge | Color-coded chip in header; passive=slate, chat=blue, confirm=amber, auto=emerald, stopped=red |
| Voice/live-mode controls | Header right-cluster with text labels (not just icons) on desktop; icons only on mobile |
| Wizards | Header dropdown, never a modal-takeover |
| Motion | 150 ms hover, 250 ms layout shift, `prefers-reduced-motion` honored on all transitions |
| Color system | emerald-600 for primary, slate-50/950 neutrals, semantic green/amber/red for state |
| Density | ~13–14px chat body, ~12px metadata, 4/8/12/16/24/32 spacing scale |

---

## What NOT to do (composite warnings)

- **Don't surface chain-of-thought in the chat.** (Cursor does this; it's noisy. Use tool chips for the structured output, keep the bubble prose-only.)
- **Don't make artifact cards modal.** (Linear, Granola get this right; v0 partially gets it wrong.) Cards live in their pane and accept inline action.
- **Don't pulse routine state.** (Linear principle.) Reserve animation for budget warnings, failed builds, open forks waiting >5 min.
- **Don't build a generic "settings" panel.** Trust mode, voice, and live mode are conductor controls — they live in the header at all times.
- **Don't conflate "in progress" with "needs decision".** A spec being written by Atlas is in-progress (status pane); a spec waiting for human approval is an artifact (artifacts pane). Same for forks: silently routing on the auto path is in-progress; an explicit fork ask is an artifact.

---

## Open questions deferred to a later spec

- Should artifact cards persist across browser sessions (saved as drafts) or always re-fetch from server? — Current spec defers to fetch-only; revisit when 1.10r drafts can be saved server-side as user-edited.
- Should the status pane support drilling into a single phase's history? — Yes eventually; out of scope here. Phase header today is read-only; tomorrow it could open a phase detail drawer.
- Should keyboard shortcuts exist for the wizards (`Cmd+K` palette)? — Future; not in this spec.

---

**End of research.** Findings drive `src/components/atlas/AtlasShell.tsx` and downstream files in this same task.
