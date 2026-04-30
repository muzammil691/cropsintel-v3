# Question — phase-1.3f

**Not blocking code (migration bridge is live), but requires a manual one-time action from Muzammil.**

---

## Manual data export required before V1/V2 users can auto-migrate

The `legacy_users` table is created and the `check-legacy-user` edge function is deployed, but the table is **empty** until you populate it with a one-time export from V1 and V2.

### Steps

#### 1. Export from V1 (almond-oracle — project `knicjcmgizovpsnmbwex`)

Go to V1 Supabase SQL Editor and run:

```sql
SELECT
  u.id            AS legacy_user_id,
  u.email,
  u.phone,
  COALESCE(p.display_name, p.full_name)   AS display_name,
  COALESCE(p.tier::text, 'registered')    AS tier,
  NULL                                     AS company_id,
  COALESCE(p.preferred_language, 'en')    AS preferred_language,
  u.created_at                             AS legacy_created_at,
  to_jsonb(u)                              AS raw_legacy_record
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id;
```

Export the result as CSV or JSON.

#### 2. Export from V2 (CropsIntelV2 — project `eywsfmixzrdfcywmdaaw`)

Run the same query on V2's SQL Editor (adjust column names if V2's `profiles` schema differs).

#### 3. Insert into V3 `legacy_users`

On V3 Supabase SQL Editor (project `hzrnohsxigrqlmzegwlb`), insert the exported rows:

```sql
INSERT INTO public.legacy_users
  (source, legacy_user_id, email, phone, display_name, tier, company_id, preferred_language, legacy_created_at, raw_legacy_record)
VALUES
  ('v1', '<uuid>', '<email>', NULL, '<name>', 'registered', NULL, 'en', '<created_at>', '{}'),
  -- ... one row per user
  ('v2', '<uuid>', '<email>', NULL, '<name>', 'registered', NULL, 'en', '<created_at>', '{}');
```

Or bulk-import via the Supabase Table Editor CSV upload.

---

## Notes

- `company_id` in `legacy_users` is stored as the V1/V2 text identifier. It is **not** linked to V3 companies yet. Phase 2 will add a company-matching step.
- Once the table is populated, any V1/V2 user who signs in to V3 with their old email or phone will be automatically migrated on first login — no further action needed.
- The `migrated_to_v3_user_id` column tracks who was migrated and when. You can audit migration progress with:

```sql
SELECT source, COUNT(*) AS total,
       COUNT(migrated_to_v3_user_id) AS migrated
FROM public.legacy_users
GROUP BY source;
```

## Master plan reference

§11.2 Phase 1.3 — "V1+V2 user migration bridge"
