// =============================================================================
// Schema type — public.verifier_runs (phase-1.10bb)
// =============================================================================
// Mirrors the live column set on public.verifier_runs after all migrations
// through 20260511000002_fix_verifier_runs_schema.sql. The Supabase
// auto-generated database.types.ts is the canonical source; this file is a
// hand-curated companion used by the Verifier service for INSERT payload
// validation so a schema/payload drift produces a TypeScript error at
// build time instead of a runtime db_write_failed.
//
// Filename matches the task spec for phase-1.10bb. The aspirational
// `atlas_verifier_runs` table name in the task spec was a documentation
// slip — the actual table is `verifier_runs` and that is what the Verifier
// service writes to.
// =============================================================================

export type VerifierRunMode = 'audit-only' | 'gate'

export type VerifierRunUnknownReason =
  | 'spec_not_found'
  | 'sync_failed'
  | 'judge_unreachable'
  | 'verify_crashed'
  | 'db_write_failed'

export interface VerifierRunRow {
  id: string
  task_id: string
  task_spec_path: string
  commit_sha: string
  mode: VerifierRunMode
  // Nullable since 20260502170000_verifier_unknown_reason.sql; NULL = "no signal".
  passed: boolean | null
  gaps: unknown // jsonb — array of { check, expected, actual, severity, remediation }
  remediation_task_id: string | null
  duration_ms: number | null
  ran_at: string // timestamptz
  // Added 20260507120000_verifier_subject_matter_hits.sql
  subject_matter_hits: number
  // Added 20260502170000_verifier_unknown_reason.sql
  unknown_reason: VerifierRunUnknownReason | null
}

// Shape accepted by the Verifier's INSERT statement. Omits server-defaulted
// columns (id, ran_at) and allows the optional-on-write fields to be omitted.
export type VerifierRunInsert = Omit<VerifierRunRow, 'id' | 'ran_at' | 'subject_matter_hits' | 'unknown_reason'> & {
  subject_matter_hits?: number
  unknown_reason?: VerifierRunUnknownReason | null
}
