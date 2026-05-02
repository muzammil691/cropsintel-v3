# V3 scope

**Source of truth:** master plan section 1.1 (`.agent/master-plan.md`). This file is a
discoverable in-repo summary so contributors and the Scope Guardian agent have a stable
reference. If this file and the master plan disagree, the master plan wins.

## V3 = CropsIntel, standalone

V3 is a clean rebuild of **CropsIntel** — a global almond market intelligence platform
with CRM/BRM/SRM relationship graphs and an AI agent layer. Same product as V1
(almond-oracle) and V2 (CropsIntelV2) at the conceptual level — different scope and
execution discipline.

## V3 is NOT

- The **MAXONS App**. That's a separate system Maxons builds for its own internal
  trading operations (Sale Contracts, Purchase Orders, shipments, payments).
- **Microsoft Business Central**. BC is Maxons' financial system of record (GL, AP/AR,
  Customer/Vendor master, inventory ledger), integrated with MAXONS App, not with V3.
- A **multi-tenant SaaS for trading houses**. (Possible v4 vision; not this scope.)
- A Lovable app, or a "rebuild that defaults back to V1 if things go wrong." V1 stays
  as a historical artifact only — no DNS rollback.
- An accounting / payments / BC-replacement system.

## Adjacent systems (knowledge only, not integration targets in V3)

| System | Job | Status for V3 |
|---|---|---|
| MAXONS App | Maxons' internal trading operations (executes Sale Contracts, POs, shipments, payments) | Separate codebase. Future integration possible. **NOT in V3 scope.** |
| Microsoft Business Central | Financial system of record (GL, AP/AR, customer/vendor master, inventory ledger) | Live, integrated with MAXONS App. **NOT in V3 scope.** |

## The MAXONS Workflow doc

`docs/MAXONS_Workflow_v1.md` is **knowledge input, not blueprint**. V3's intelligence
(Zyra, Atlas, market analytics, prescription engine) is grounded in real almond-trading
process knowledge from that doc, but **V3 does not execute trading workflows**.
CropsIntel users come to V3 for market intelligence and CRM-style features, not to
issue Sale Contracts or post to GL.

## What this means for new work

Per the **Scope Guardian** agent (master plan section D2), the following are
automatically rejected as out-of-scope, regardless of who requests them:

- Sale Contract issuance (Workflow 3 — MAXONS App's job)
- Purchase Contract issuance and back-to-back linking (Workflow 4 — MAXONS App's job)
- Shipping Instruction submission flow (Workflow 5 — MAXONS App + portals there)
- Posting of any kind to Business Central
- Bank document presentation, LC workflows, payment instruction APIs
- E-signature platform integrations (DocuSign etc.)
- Carrier booking integrations (INTTRA etc.)

If a feature request crosses any of these lines, write a question file under
`.agent/questions/` instead of building it.

## See also

- Master plan section 1.1 (this scope statement, canonical)
- Master plan section 1.7 (multi-portal — no per-department portals for Maxons)
- Master plan section 1.8 (trade lifecycle — knowledge, not execution)
- Master plan section 1.11 (full "V3 explicitly is NOT" list)
- `V3-CODING-INSTRUCTIONS.md` section 0 (the five immutable rules)
