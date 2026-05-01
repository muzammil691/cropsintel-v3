-- Phase 1.10x: loop health columns on atlas_snapshots
-- Surfaces "is the autonomous loop healthy?" in the dashboard:
--   - loop_lag_seconds: time since most-recent queue arrival without a pickup
--   - dependency_violations_count: queued specs blocked by missing depends-on
--   - priority_inversions_count: deeper specs with priority < current head
ALTER TABLE public.atlas_snapshots
  ADD COLUMN IF NOT EXISTS loop_lag_seconds              int,
  ADD COLUMN IF NOT EXISTS dependency_violations_count   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority_inversions_count     int NOT NULL DEFAULT 0;
