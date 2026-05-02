---
priority: 3
source: atlas-plan-tree
---

# Task: 1.1 V3 = CropsIntel, standalone


V3 is a clean rebuild of **CropsIntel** — a global almond market intelligence platform with CRM/BRM/SRM relationship graphs and an AI agent layer. Same product as V1 (almond-oracle) and V2 (CropsIntelV2) at the conceptual level — different scope and execution discipline.

**V3 is NOT:**
- The MAXONS App. That's a separate system Maxons builds for its own internal trading operations.
- Microsoft Business Central. BC is Maxons' financial system of record, integrated with MAXONS App, not with V3.
- A multi-tenant SaaS for trading houses. (That's a possible future v4 vision; not this scope.)

**Adjacent systems V3 may eventually integrate with (but not now):**

| System | Job | Status for V3 |
|---|---|---|
| **MAXONS App** | Maxons' internal trading operations system (executes Sale Contracts, Purchase Orders, shipments, payments) | Separate codebase. Future integration possible. NOT in V3 scope. |
| **Microsoft Business Central** | Financial system of record (GL, AP/AR, Customer/Vendor master, inventory ledger) | Live, integrated with MAXONS App. NOT in V3 scope. |

**The MAXONS Workflow doc is knowledge input, not blueprint.** V3's intelligence (Zyra, Atlas, market analytics, prescription engine) is grounded in real almond-trading process knowledge from that doc, but V3 does not execute trading workflows. CropsIntel users come to V3 for market intelligence and CRM-style features, not to issue Sale Contracts or post to GL.

## Source plan node

- Phase hint: plan
- Generated: 2026-05-02T13:05:14.426Z
