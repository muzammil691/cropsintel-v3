# SKIP — V1 migration rejected by user 2026-04-29

**Agent: do not execute this task. Move it to `.agent/tasks/done/` immediately and continue to the next queued task.**

V1's parsing was incomplete and inaccurate. V3 will scrape authoritative
sources directly and continuously instead — see `phase-1.06-adela-skeleton.md`
for the live scraping work.

The intelligence layer is built by Adela, NOT by migrating V1's flawed dataset.

Replacement plan (master plan v1.5 row 1.6, expanded):
- Adela is a separate Railway service (sibling to `cropsintel-agent`)
- Runs cron schedules
- Scrapes ABC (Almond Board of California position reports + monthly market reports), USDA NASS (crop production statistics), USDA AMS (market news), industry blogs/news (RSS)
- Daily check for new content; backfill from each source's archive on first run
- Uses Gemini Pro for PDF/HTML extraction
- Uses Claude for synthesis (monthly briefs, anomaly detection)
- Writes to V3 Supabase (`market_intelligence`, `position_reports`, `news`, `scraped_intel` tables)
- Audit log in `adela_runs`

**Action:** mark this task as done with no commits to source code; move file to `done/`.
