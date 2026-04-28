# Task: Phase 1.6 — CRM (Contacts + Activity Log)

**Master plan reference:** section 11.6
**Depends on:** Phase 1.5 (app shell must exist)
**Estimated effort:** ~6-8 hours; iterate.

---

## Goal

Build the CRM module: contacts table (buyers/sellers/agents/internal), activity logging, contact detail page. This is one of the three relationship layers (CRM/BRM/SRM) from the master plan.

## In scope

### Schema (write migration `20260429xxxxxx_crm.sql`)
- `contacts` table: id, org_id, contact_name, company_name, country, role enum('buyer','seller','agent','internal','other'), email, phone, whatsapp, notes, tags text[], created_at, updated_at, owner_id (auth.users)
- `contact_activities` table: id, contact_id, activity_type enum('email','call','meeting','whatsapp','note'), subject, body text, occurred_at, logged_by, metadata jsonb
- `contact_imports` table: id, org_id, filename, row_count, success_count, fail_count, errors jsonb, imported_by, imported_at
- RLS: org members can read/write their org's contacts; admins can delete

### Pages
- `src/pages/CRM.tsx` — main CRM page (replaces placeholder from 1.5). Tabs: All Contacts / Buyers / Sellers / Agents / Internal. Each tab shows a sortable, searchable table.
- `src/pages/crm/ContactDetail.tsx` — `/crm/:id` — contact info card + activity timeline + "Log activity" form
- `src/pages/crm/ContactImport.tsx` — `/crm/import` — CSV upload, column mapping, preview, commit

### Components
- `src/components/crm/ContactTable.tsx` — TanStack Table with column visibility toggle, search, filters
- `src/components/crm/ContactForm.tsx` — create/edit dialog
- `src/components/crm/ActivityTimeline.tsx` — vertical timeline of activities
- `src/components/crm/LogActivityDialog.tsx` — form: activity type → subject → body → save

### Library
- `src/lib/crm.ts` — getContacts, getContact, createContact, updateContact, deleteContact, logActivity, importCSV

### Routing
- `/crm` → CRM tab list
- `/crm/:id` → contact detail
- `/crm/import` → import flow

## Out of scope
- BRM (deals pipeline) — Phase 1.7
- SRM (supplier scoring) — Phase 1.8
- Email integration / IMAP read of activities (Phase 2)
- Bulk WhatsApp sending (this exists in V2 but stays out of V3 until Phase 2 to keep scope tight)

## Acceptance criteria

1. User on `/crm` sees their org's contacts (empty state if none)
2. Can create a contact via dialog → saved → appears in table
3. Click contact row → detail page shows activity timeline
4. Can log activity → saved → appears in timeline
5. CSV import: upload file → see preview with column mapping → commit → 90%+ success rate on a 50-row sample
6. Tabs filter by role correctly
7. Search box filters by contact_name OR company_name (case insensitive)
8. RLS verified: a user from another org gets empty results on /crm
9. `npm run build` passes
10. At least 2 Playwright e2e tests: create contact, log activity

## Notes
- Use TanStack Table v8 (`npm install @tanstack/react-table`) — much better than the V2 hand-rolled table
- CSV parsing: papaparse (`npm install papaparse @types/papaparse`)
- Keep contact_activities denormalized for now (no separate participants table); we can normalize later
- Tags column: use shadcn's badge component for display; use a multi-select for editing

---

**Done condition:** CRM is functional — create/read/update contacts, log activities, import CSV — build green.
