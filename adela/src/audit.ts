import { supabase } from "./supabase.js"

export interface RunRecord {
  id: string
  scraper: string
  started_at: string
}

export async function startRun(scraper: string): Promise<RunRecord> {
  const { data, error } = await supabase
    .from("adela_runs")
    .insert({ scraper, status: "running" })
    .select("id, scraper, started_at")
    .single()

  if (error || !data) {
    throw new Error(`Failed to start audit run for ${scraper}: ${error?.message}`)
  }
  return data as RunRecord
}

export async function finishRun(
  runId: string,
  status: "success" | "failed" | "skipped",
  opts: {
    rows_inserted?: number
    rows_skipped?: number
    error_message?: string
    metadata?: Record<string, unknown>
  } = {}
): Promise<void> {
  const { error } = await supabase
    .from("adela_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      rows_inserted: opts.rows_inserted ?? 0,
      rows_skipped: opts.rows_skipped ?? 0,
      error_message: opts.error_message ?? null,
      metadata: opts.metadata ?? {},
    })
    .eq("id", runId)

  if (error) {
    console.error(`[audit] Failed to update run ${runId}:`, error.message)
  }
}
