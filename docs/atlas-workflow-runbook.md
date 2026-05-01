# Atlas Workflow Runbook

**Status:** living document. Last revised 2026-05-01 alongside phase-1.10ae.
**Audience:** Muzammil (operator), and any future engineer onboarding to the Atlas production house.
**Companion specs:** master plan §1.6 (Atlas), §9 (runtime agents), §10 (AI provider routing), and the phase-1.10z..ae spec series.

When Atlas is asked anything about workflow, it should cite a section number from this document rather than improvising.

---

## §1. Vision

Atlas is the **conductor** of the CropsIntel V3 production house. It does not write features itself; it dispatches tools that drive a team of seven specialised agents — Council (planner), Builder (implementer), Verifier (auditor), Designer (UI judge), Adela (data ingestor), Memory (RAG), and Multi-Brain (council debater). Atlas's job:

1. Hold the master plan + outcomes in memory.
2. Pick up user intent (chat, voice, WhatsApp, cron) and translate it to one or more tool calls.
3. Watch the artifacts those tools produce, surface deltas to the user, and self-heal where the trust mode allows.
4. Stay honest: never claim a side effect happened without the corresponding verification call.

Atlas is single-user (Muzammil) for now. Phase 4 graduates it to Atlas-Pro with a self-improvement loop.

---

## §2. Agent inventory

| Agent | Endpoint / surface | Responsibility | Tool keys (Atlas-side) |
|---|---|---|---|
| **Atlas** itself | `/atlas`, `/atlas-brain`, `/atlas-pd` UI + Railway service | Orchestrator. Routes intent → tools. | n/a (callee, not callable) |
| **Council** | `council.write_spec` (Atlas tool) | First-draft a phase spec from the master plan. | `council.write_spec`, `atlas.draft_spec` (composes Council + Multi-Brain) |
| **Builder** | `.agent/tasks/queued/` → loop | Picks up a queued spec, implements it, runs build, commits, pushes. | `builder.queue_spec`, `builder.list_queue`, `builder.list_done`, `builder.cancel_task`, `builder.set_priority`, `builder.set_dependencies`, `builder.queue_order` |
| **Verifier** | Railway service (`VERIFIER_URL`) | Audits a Builder commit range against the spec. Returns verdict + gaps + confidence. | `verifier.audit`, `verifier.recent_runs` |
| **Designer** | Edge function / Railway worker | Reviews specs and shipped UI for design quality. | `designer.review_spec`, `designer.audit_commit` |
| **Adela** | Railway service (`adela/`) | Cron-driven data ingest (USDA, ABC, news, IMAP). | `adela.trigger_scrape` |
| **Memory** | Railway service (`MEMORY_URL`) | RAG over master plan + audits + V1/V2 codebases. | `memory.search`, `memory.ingest` |
| **Multi-Brain** | `multi-brain` edge function | Claude + GPT + Gemini in parallel; GPT-4o judges. | called inside `atlas.draft_spec` and `atlas.propose_and_queue`; UI at `/atlas-brain` |
| **WhatsApp gateway** | Twilio (`whatsapp.send`) | Fallback channel for stuck/escalation pings. | `whatsapp.send` |
| **drAtlas** (event log) | `atlas_events` table + `/atlas-pd` Events tab | Append-only audit log for every Atlas+UI action. | indirect — every tool dispatch writes here |
| **Status snapshot** | `status.snapshot` tool | Computes current project state (queue counts, recent ships, costs). | `status.snapshot` |

Total: **7 agents** in the canonical workflow (Council, Builder, Verifier, Designer, Adela, Memory, Multi-Brain), conducted by Atlas, observed by drAtlas. WhatsApp is the channel; status.snapshot is a query, not an agent.

---

## §3. Canonical workflow

```
        ┌──────── user (chat / voice / WhatsApp / cron) ────────┐
        ▼                                                       ▲
   ┌─────────┐    intent      ┌─────────┐                       │
   │  Atlas  │───────────────▶│ Council │  draft markdown       │
   │         │◀───────────────│         │                       │
   └────┬────┘   spec md      └─────────┘                       │
        │                                                       │
        │ atlas.draft_spec → Multi-Brain (Claude/GPT/Gemini)    │
        │                ↓                                      │
        │        judge (GPT-4o) → consensus                     │
        ▼                                                       │
   invariant check (cost, deps, RBAC, walls) ──fail──▶ refuse ──┘
        │ pass
        ▼
   ┌────────────┐  trust=auto?   ┌─────────────────────┐
   │ propose +  │───── yes ─────▶│ builder.queue_spec  │
   │  queue     │   else stage   └──────────┬──────────┘
   └────────────┘                           │ git commit + push
                                            ▼
                                    ┌──────────────┐
                                    │ Builder loop │ (Railway VPS)
                                    └──────┬───────┘
                                           │ build + commit + push
                                           ▼
                                  ┌──────────────────┐
                                  │ verifier.audit   │
                                  └────┬─────────┬───┘
                                  pass │         │ fail
                                       ▼         ▼
                              designer.audit  research + reloop (1.10ad)
                                       │         │
                                       ▼         ▼
                                surface in     re-queue
                                /atlas-pd      with critique
```

Every node above writes to `atlas_events` so the workflow trace card (Atlas dashboard) can replay any run.

---

## §4. Failure modes

| Stage | Failure | What happens | Where to look |
|---|---|---|---|
| Builder | Hangs past timeout | watchdog kills, spec moved to `.agent/tasks/failed/`, WhatsApp ping fired | `.agent/tasks/failed/`, `whatsapp_outbound` table |
| Builder | Build red after 5 retries | spec moved to `failed/`, WhatsApp ping; no auto re-queue | `.agent/tasks/failed/<id>.md` |
| Verifier | Verdict fail, confidence ≥ 0.7 | research + re-loop spec generated by 1.10ad pipeline | `verifier_runs`, new spec in `queued/` with `-reloop` suffix |
| Verifier | Verdict fail, confidence < 0.7 | push proceeds with warning banner on `/atlas-pd` | `/atlas-pd` → Validation tab |
| Designer | Verdict < 0.7 on UI files | remediation spec queued (small visual fix); operator can dismiss | `/atlas-pd` → Validation tab |
| Atlas conductor | Snapshot stale (> 10 min in auto mode) | anomaly detected → self-heal: re-run `status.snapshot`; if still stale, drop to confirm mode + WhatsApp ping | `atlas_events` filter `event_type='snapshot_anomaly'` |
| Memory | Drift (new commits not ingested) | daily reconcile cron (planned, not yet shipped) | `memory_ingest_runs` table |
| Multi-Brain | One provider 5xx | judge proceeds with remaining; spec annotated `partial_consensus=true` | `brain_debates.partial_consensus` |
| Cost gate | Provider over budget | tool returns `blocked` with `Budget gate:` reason; Atlas surfaces verbatim | `ai_costs` table, gate in `atlas/src/lib/cost-gate.ts` |

---

## §5. Escalation paths

Three escalation channels, in increasing severity:

1. **Fork question** — Atlas asks the user a structured choice in chat. Trigger: spec is ambiguous, or invariant check finds a soft warning (e.g. dep missing but not load-bearing). Stored in `atlas_forks` table; surfaced in `/atlas` ForkList.
2. **WhatsApp ping** — Twilio outbound message to the operator's phone. Trigger: any of (Builder failed/timeout, Verifier hard fail, snapshot anomaly while operator off-screen, budget cap hit). Sent via `whatsapp.send`. Throttled to ≤10/hour.
3. **Emergency stop** — operator says "stop" or trust mode is flipped to `stopped`. All write tools blocked at `dispatch.ts:42`. Atlas chat continues read-only. Lifts only on explicit operator command.

---

## §6. Trust mode behaviors

| Mode | Read tools | Write tools | Multi-Brain debate | Auto-queue specs | Use when |
|---|---|---|---|---|---|
| `passive` | ✅ | ❌ | ❌ | ❌ | Inspection / shadowing only |
| `chat` | ✅ | ❌ | ✅ (preview only) | ❌ | Drafting + reasoning, no side effects |
| `confirm` | ✅ | requires explicit OK | ✅ | After OK | Default operating mode |
| `auto` | ✅ | ✅ (under cost cap) | ✅ | ✅ | Trusted backlog burndown |
| `stopped` | (chat-only banner) | ❌ | ❌ | ❌ | Emergency / paused |

Mode is shown in the `TrustModeBadge` (Atlas header) and overridable via `WizardBar`. Atlas system prompt §1 references this matrix when explaining what it can/can't do.

---

## §7. Cost discipline

Per-provider monthly ceilings (master plan §10.3):

| Provider | Monthly cap | Where enforced |
|---|---|---|
| Anthropic (Claude) | $200 | `cost-gate.ts` checks `ai_costs` MTD |
| OpenAI (GPT + embeddings) | $50 | same gate |
| Gemini | $50 | same gate |
| ElevenLabs (TTS + STT) | $100 | TTS hook checks `tts_costs` MTD |
| **Total** | **$400/mo** | — |

Per-tool soft estimates (`AI_COST_ESTIMATES` in `dispatch.ts`):

- `council.write_spec` ≈ $0.10
- `atlas.draft_spec` ≈ $0.35 (Council + Multi-Brain)
- `atlas.propose_and_queue` ≈ $0.40
- `designer.review_spec` / `designer.audit_commit` ≈ $0.05 each
- `memory.search` / `adela.trigger_scrape` ≈ $0.001

Alert thresholds: 60% warn (banner), 80% throttle (Multi-Brain disabled), 100% block. Operator can override with a token (`overrideToken` on `DispatchRequest`).

---

## §8. Reading runtime state

Quick-reference: which Supabase view answers which question.

| Question | Where to look | Tool |
|---|---|---|
| What's in the queue? | `.agent/tasks/queued/` (filesystem) or queue order view | `builder.list_queue`, `builder.queue_order` |
| What shipped this week? | `.agent/tasks/done/` (filesystem) | `builder.list_done` (with `filter=` substring) |
| Latest verifier results? | `verifier_runs` table | `verifier.recent_runs` |
| Multi-Brain debate history? | `brain_debates`, `brain_debate_messages` | `/atlas-brain` UI |
| Open proposals + decisions? | `atlas_proposals`, `atlas_decisions` | `/atlas-pd` Proposals/Decision Log tabs |
| Live event tail? | `atlas_events` (chronological append-only) | `/atlas-pd` Events tab (planned), or direct query |
| Cost MTD? | `ai_costs` view | shown in `/atlas` Status pane and `/atlas-brain` `CostFooter` |
| Trust mode + snapshot? | `atlas_status` view | `status.snapshot` |
| Current proposals awaiting AI review? | `atlas_proposals.review_status` | `/atlas-pd` Proposals tab |

---

## Maintenance

This runbook is the contract Atlas cites in chat. **When the canonical workflow or agent inventory changes, the spec that changes it MUST update this file in the same commit.** A drift between code and runbook is a verifier finding.
