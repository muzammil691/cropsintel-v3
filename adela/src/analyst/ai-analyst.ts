/**
 * Phase 1.6f: Adela AI Analyst Pipeline (Gemini + Claude)
 *
 * Orchestrates the 5-step pipeline:
 * 1. Fetch position_reports from last 7 days
 * 2. Extract market signals via Gemini
 * 3. Generate plain-English brief via Claude
 * 4. Upsert to ai_analyses table
 * 5. Write completion audit to atlas_dispatches
 *
 * Each AI call automatically writes to atlas_cost_log via the client wrappers.
 */

import { z } from "zod";
import { supabase } from "../lib/supabase-client";
import { geminiGenerate } from "../lib/gemini-client";
import { claudeComplete } from "../lib/anthropic-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const MarketSignalsSchema = z.object({
  demand_strength: z.enum(["low", "medium", "high"]),
  supply_tightness: z.enum(["loose", "balanced", "tight"]),
  price_direction: z.enum(["falling", "stable", "rising"]),
  key_markets: z.array(z.string()),
});

export type MarketSignals = z.infer<typeof MarketSignalsSchema>;

interface PositionReport {
  id: string;
  commodity: string;
  position_lbs: number;
  report_date: string;
  report_week: string;
  [key: string]: unknown;
}

class DependencyError extends Error {
  constructor(missingTable: string) {
    super(`Required table does not exist: ${missingTable}`);
    this.name = "DependencyError";
  }
}

// ---------------------------------------------------------------------------
// Pre-flight Check
// ---------------------------------------------------------------------------

async function checkDependencies(): Promise<void> {
  const requiredTables = [
    "position_reports",
    "ai_analyses",
    "atlas_dispatches",
    "atlas_cost_log",
  ];

  for (const table of requiredTables) {
    const { error } = await (supabase.from(table) as any).select("id").limit(1);

    if (error && error.message.includes("does not exist")) {
      throw new DependencyError(table);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 1: Fetch Data
// ---------------------------------------------------------------------------

async function fetchPositionReports(): Promise<PositionReport[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoffDate = sevenDaysAgo.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("position_reports")
    .select("*")
    .gte("report_date", cutoffDate)
    .order("report_date", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch position_reports: ${error.message}`);
  }

  return (data ?? []) as PositionReport[];
}

// ---------------------------------------------------------------------------
// Step 2: Extract Signals (Gemini)
// ---------------------------------------------------------------------------

async function extractSignals(
  reports: PositionReport[]
): Promise<MarketSignals> {
  const prompt = buildSignalPrompt(reports);

  // Gemini returns { demand_strength, supply_tightness, price_direction, key_markets }
  const response = await geminiGenerate(prompt, MarketSignalsSchema);

  return response.data;
}

function buildSignalPrompt(reports: PositionReport[]): string {
  let prompt = `You are a commodity market analyst. Analyze the following position reports from the last 7 days and extract structured market signals.\n\n`;

  prompt += `## Position Reports (${reports.length} rows)\n\n`;

  if (reports.length > 0) {
    // Show top 20 reports
    reports.slice(0, 20).forEach((r) => {
      prompt += `- ${r.commodity}: ${r.position_lbs.toLocaleString()} lbs on ${r.report_date} (week ${r.report_week})\n`;
    });

    if (reports.length > 20) {
      prompt += `\n... and ${reports.length - 20} more reports\n`;
    }
  }

  prompt += `\n\nBased on these position reports, extract the following market signals:\n`;
  prompt += `- demand_strength: "low" | "medium" | "high"\n`;
  prompt += `- supply_tightness: "loose" | "balanced" | "tight"\n`;
  prompt += `- price_direction: "falling" | "stable" | "rising"\n`;
  prompt += `- key_markets: array of 2-4 commodity names that show the most significant activity\n`;
  prompt += `\nReturn ONLY valid JSON matching the schema.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Step 3: Generate Brief (Claude)
// ---------------------------------------------------------------------------

async function generateBrief(
  reports: PositionReport[],
  signals: MarketSignals
): Promise<string> {
  const systemPrompt = `You are a senior commodity analyst writing daily market briefs for traders. Your briefs are concise, clear, and avoid jargon. Focus on actionable insights.`;

  const userMessage = buildBriefPrompt(reports, signals);

  const response = await claudeComplete(systemPrompt, userMessage, {
    maxTokens: 512,
  });

  return response.text.trim();
}

function buildBriefPrompt(
  reports: PositionReport[],
  signals: MarketSignals
): string {
  let prompt = `Write a 200-300 word plain-English market brief for today based on the following data:\n\n`;

  prompt += `## Market Signals\n`;
  prompt += `- Demand strength: ${signals.demand_strength}\n`;
  prompt += `- Supply tightness: ${signals.supply_tightness}\n`;
  prompt += `- Price direction: ${signals.price_direction}\n`;
  prompt += `- Key markets: ${signals.key_markets.join(", ")}\n\n`;

  prompt += `## Position Data Summary\n`;
  prompt += `- Total reports: ${reports.length}\n`;

  if (reports.length > 0) {
    const commodities = new Set(reports.map((r) => r.commodity));
    prompt += `- Commodities tracked: ${commodities.size} (${Array.from(commodities).slice(0, 5).join(", ")})\n`;

    const totalPosition = reports.reduce((sum, r) => sum + r.position_lbs, 0);
    prompt += `- Total position volume: ${totalPosition.toLocaleString()} lbs\n`;

    const topReport = reports[0];
    prompt += `- Latest report: ${topReport.commodity} at ${topReport.position_lbs.toLocaleString()} lbs on ${topReport.report_date}\n`;
  }

  prompt += `\n\nWrite a 200-300 word brief that:\n`;
  prompt += `1. Summarizes the current market state\n`;
  prompt += `2. Highlights the most important trends\n`;
  prompt += `3. Provides actionable insights for traders\n`;
  prompt += `4. Uses plain English (no jargon)\n\n`;
  prompt += `Your brief:`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Step 4: Upsert Analysis
// ---------------------------------------------------------------------------

async function upsertAnalysis(
  signals: MarketSignals,
  brief: string
): Promise<{ analysisDate: string; confidenceScore: number }> {
  const analysisDate = new Date().toISOString().split("T")[0];

  // Calculate confidence score based on signal strength
  const confidenceScore = calculateConfidenceScore(signals, brief);

  const { error } = await (supabase.from("ai_analyses") as any).upsert(
    {
      analysis_date: analysisDate,
      model_used: "gemini-1.5-pro + claude-sonnet-4-5",
      input_data: { signals },
      signals: signals,
      brief: brief,
      confidence_score: confidenceScore,
    },
    { onConflict: "analysis_date" }
  );

  if (error) {
    throw new Error(`Failed to upsert ai_analyses: ${error.message}`);
  }

  return { analysisDate, confidenceScore };
}

function calculateConfidenceScore(
  signals: MarketSignals,
  brief: string
): number {
  let score = 0.5; // Base score

  // Increase confidence if signals are clear (high/tight/rising or low/loose/falling)
  if (
    (signals.demand_strength === "high" &&
      signals.supply_tightness === "tight" &&
      signals.price_direction === "rising") ||
    (signals.demand_strength === "low" &&
      signals.supply_tightness === "loose" &&
      signals.price_direction === "falling")
  ) {
    score += 0.3;
  } else if (signals.demand_strength === "medium" || signals.supply_tightness === "balanced") {
    score += 0.1; // Moderate signals
  }

  // Increase confidence if key_markets has good coverage (2-4 markets)
  if (signals.key_markets.length >= 2 && signals.key_markets.length <= 4) {
    score += 0.1;
  }

  // Increase confidence if brief is within target word count (200-300)
  const wordCount = brief.split(/\s+/).length;
  if (wordCount >= 180 && wordCount <= 320) {
    score += 0.1;
  }

  return Math.min(1.0, Math.max(0.0, score));
}

// ---------------------------------------------------------------------------
// Step 5: Write Audit Dispatch
// ---------------------------------------------------------------------------

async function writeAuditDispatch(
  analysisDate: string,
  confidenceScore: number
): Promise<void> {
  const { error } = await (supabase.from("atlas_dispatches") as any).insert({
    event: "ai_analyst_complete",
    payload: {
      analysis_date: analysisDate,
      confidence_score: confidenceScore,
      timestamp: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to write atlas_dispatches: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

export async function runAiAnalyst(): Promise<void> {
  console.log("[ai-analyst] Starting pipeline");

  // Pre-flight: check dependencies
  await checkDependencies();
  console.log("[ai-analyst] Dependencies verified");

  // Step 1: Fetch data
  const reports = await fetchPositionReports();

  if (reports.length === 0) {
    console.warn(
      "[ai-analyst] No position_reports for last 7 days, exiting early"
    );
    return;
  }

  console.log(`[ai-analyst] Fetched ${reports.length} position reports`);

  // Step 2: Extract signals (Gemini)
  const signals = await extractSignals(reports);
  console.log("[ai-analyst] Signals extracted:", signals);

  // Step 3: Generate brief (Claude)
  const brief = await generateBrief(reports, signals);
  const wordCount = brief.split(/\s+/).length;
  console.log(`[ai-analyst] Brief generated (${wordCount} words)`);

  // Validate brief word count (soft bounds)
  if (wordCount < 180 || wordCount > 320) {
    console.warn(
      `[ai-analyst] Brief word count ${wordCount} outside target range 180-320`
    );
  }

  // Step 4: Upsert analysis
  const { analysisDate, confidenceScore } = await upsertAnalysis(signals, brief);
  console.log(
    `[ai-analyst] Analysis upserted for ${analysisDate} (confidence: ${confidenceScore.toFixed(2)})`
  );

  // Step 5: Write audit dispatch
  await writeAuditDispatch(analysisDate, confidenceScore);
  console.log("[ai-analyst] Audit dispatch written");

  console.log("[ai-analyst] Pipeline complete");
}
