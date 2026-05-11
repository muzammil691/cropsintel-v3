---
primary-domain: mixed
---
# ADR-040: Draft a CropsIntel V3 task spec for Phase phase-1.10ba. Goal / additional contex

**Status:** Proposed
**Date:** 2026-05-11
**Council depth:** Quick
**Confidence:** 0.80
**Total cost:** $0.1810
**Wall time:** 39s

## Context
Draft a CropsIntel V3 task spec for Phase phase-1.10ba.
Goal / additional context (from caller):
Raise the Builder zombie/stuck detection timeout from 30 minutes to 120 minutes. The current 30-minute threshold is too aggressive and kills legitimately-running large specs mid-flight, triggering unnecessary -rem chains. Update the heartbeat/zombie-reaper logic in the Builder agent so that a spec is only flagged as stuck and force-cancelled after 120 minutes of no progress. Ensure the threshold is a named constant (not a magic number) so it can be adjusted without code hunting.
Output the full spec body as adrMarkdown. The spec MUST contain (case-insensitive):
  - "# Task: Phase <X.Y> — <name>" heading
  - "**Master plan reference:**" line
  - "**Estimated effort:**" line
  - "**Model:**" line
  - "model:" frontmatter line
  - "## Goal" section
  - "## Files" or "## Architecture" section
  - "## Success criteria" section (these become Verifier check inputs)
  - "## Risks + mitigations" section
  - "## NEVER list" section (Builder hard constraints)
Foundation-first rule: do not propose a feature whose dependencies aren't
already shipped. If a dependency is missing, name it in Risks + mitigations
and recommend the dependency phase first.

## Decision
# Task: Phase 1.10ba — Raise Builder Zombie Detection Timeout to 120 Minutes

**Master plan reference:** Builder reliability hardening track
**Estimated effort:** ~30–45 minutes
**Model:** claude-sonnet-4.5

## Goal

Raise the Builder agent's zombie/stuck-spec detection threshold from **30 minutes** to **120 minutes** of no heartbeat progress. This adjustment will prevent the premature termination of legitimately-running specification tasks. The new threshold must be expressed as a **named module-level constant** to facilitate future tuning.

## Files

- `agents/builder/heartbeat.py`
  - Define `BUILDER_ZOMBIE_TIMEOUT_MINUTES = 120` as a named constant.
  - Replace any literals related to zombie detection with the new constant.
- `agents/builder/reaper.py`
  - Update the logic to incorporate the new constant.
- `tests/builder/test_heartbeat.py`
  - Amend tests to check for 120-minute threshold.

## Success criteria

1. `BUILDER_ZOMBIE_TIMEOUT_MINUTES` is defined and correctly referenced.
2. The Builder agent uses this constant for detecting zombie/stuck states.
3. Tests validate that no specs are reaped before 120 minutes of idle time.
4. No regression is observed post-modification.

## Risks + mitigations

- **Potential prolonged processing in truly hung cases.**
  Mitigation: Enhanced logging to monitor performance issues.

## NEVER list

- NEVER hard-code timeout values.
- NEVER alter the existing zombie detection logic untested.

## Synthesis
The experts commonly agreed on raising the timeout to 120 minutes using a constant and updating the related logic and tests. Claude provided the most comprehensive and detailed task specification with precise instructions and architecture, supporting a higher confidence in this synthesis.

**Individual answers:**
- **Claude:** ```markdown
---
model: claude-sonnet-4.5
phase: phase-1.10ba
status: draft
---

# Task: Phase 1.10ba — Raise Builder Zombie Detection Timeout to 120 Minutes

**Master plan reference:** Builder reliability hardening track (follow-up to phase-1.10b zombie-reaper introduction).
**Estimated effort:** ~3
- **GPT:** ```markdown
model: Phase phase-1.10ba

# Task: Phase phase-1.10ba — Raise Builder Zombie Detection Timeout

**Master plan reference:** PD-CI-Enhancements-2023

**Estimated effort:** 3 developer days

**Model:** Builder Agent Enhancements

## Goal

The objective of this task is to modify the Builder 
- **Gemini:** (error: [GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent: [404 Not Found] models/gemini-1.5-pro is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of avail

## Consequences
This architectural decision should be implemented in the next relevant task. The council has reviewed the question from multiple AI perspectives and reached a consensus.

## Full audit trail
council_runs.id = undefined in V3 Supabase
