/**
 * Phase 1.6e: Adela AI Analyst — Daily Brief Generator
 *
 * Fetches scraped data (position_reports, strata_prices, market_news) from
 * Supabase, sends to Gemini for signal extraction and Claude for narrative
 * brief generation, then upserts to ai_analyses table with cost logging.
 *
 * Usage:
 *   import { run } from "./ai-analyst"
 *   const result = await run()
 */

import { supabase } from "./lib/supabase"
import { extractStructured } from "./lib/gemini"
import { generateText } from "./lib/claude"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PositionReport {
  commodity: string
  position_lbs: number
  report_week: string
  created_at: string
  [key: string]: unknown
}

export interface StrataPrice {
  variety: string
  size_grade?: string
  price_per_lb_usd: number
  snapshot_date: string
  [key: string]: unknown
}

export interface MarketNewsItem {
  title: string
  summary?: string
  url: string
  published_at: string
  [key: string]: unknown
}

export interface AnalystContext {
  reportDate: string
  positionReports: PositionReport[]
  strataPrices: StrataPrice[]
  marketNews: MarketNewsItem[]
}

export interface MarketSignal {
  rank: number
  signal: string
  market: string
  direction: "up" | "down" | "neutral"
  confidence: number
}

export interface AiAnalysisRow {
  report_date: string
  signals: MarketSignal[]
  brief_text: string
  model_used: string
  tokens_in: number
  tokens_out: number
  cost_usd: number
}

export interface RunResult {
  status: "success" | "skipped"
  reason?: string
  analysis?: AiAnalysisRow
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_COST_PER_1M_IN = 0.075 // Gemini Flash 2.0 input
const GEMINI_COST_PER_1M_OUT = 0.30 // Gemini Flash 2.0 output
const CLAUDE_COST_PER_1M_IN = 3.0 // Claude Sonnet 4.5 input
const CLAUDE_COST_PER_1M_OUT = 15.0 // Claude Sonnet 4.5 output

// ---------------------------------------------------------------------------
// Signal Extraction Schema (Gemini)
// ---------------------------------------------------------------------------

const SIGNAL_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          signal: { type: "string" },
          market: { type: "string" },
          direction: { type: "string", enum: ["up", "down", "neutral"] },
          confidence: { type: "number" },
        },
        required: ["rank", "signal", "market", "direction", "confidence"],
      },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ["signals"],
}

// ---------------------------------------------------------------------------
// Step 1: Fetch Data
// ---------------------------------------------------------------------------

export async function fetchData(): Promise<{
  positionReports: PositionReport[]
  strataPrices: StrataPrice[]
  marketNews: MarketNewsItem[]
}> {
  // Get current week's position reports
  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  const weekStr = oneWeekAgo.toISOString().split("T")[0]

  const { data: positionReports, error: posErr } = await supabase
    .from("position_reports")
    .select("*")
    .gte("report_week", weekStr)
    .order("report_week", { ascending: false })
    .limit(50)

  if (posErr) {
    console.error("[ai-analyst] Error fetching position_reports:", posErr.message)
    return { positionReports: [], strataPrices: [], marketNews: [] }
  }

  // Get latest strata prices
  const { data: strataPrices, error: priceErr } = await supabase
    .from("strata_prices")
    .select("*")
    .order("snapshot_date", { ascending: false })
    .limit(50)

  if (priceErr) {
    console.warn("[ai-analyst] Error fetching strata_prices:", priceErr.message)
  }

  // Get market news from last 48 hours
  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
  const newsDate = twoDaysAgo.toISOString()

  const { data: marketNews, error: newsErr } = await supabase
    .from("market_news")
    .select("*")
    .gte("published_at", newsDate)
    .order("published_at", { ascending: false })
    .limit(20)

  if (newsErr) {
    console.warn("[ai-analyst] Error fetching market_news:", newsErr.message)
  }

  const reports = (positionReports ?? []) as PositionReport[]
  const prices = (strataPrices ?? []) as StrataPrice[]
  const news = (marketNews ?? []) as MarketNewsItem[]

  if (reports.length === 0) {
    console.warn("[ai-analyst] WARN: no position_reports for current week")
  }

  return {
    positionReports: reports,
    strataPrices: prices,
    marketNews: news,
  }
}

// ---------------------------------------------------------------------------
// Step 2: Build Context
// ---------------------------------------------------------------------------

export function buildContext(data: {
  positionReports: PositionReport[]
  strataPrices: StrataPrice[]
  marketNews: MarketNewsItem[]
}): AnalystContext {
  const reportDate = new Date().toISOString().split("T")[0]
  return {
    reportDate,
    positionReports: data.positionReports,
    strataPrices: data.strataPrices,
    marketNews: data.marketNews,
  }
}

// ---------------------------------------------------------------------------
// Step 3: Extract Signals (Gemini primary, Claude fallback)
// ---------------------------------------------------------------------------

export async function extractSignals(
  context: AnalystContext
): Promise<{ signals: MarketSignal[]; modelUsed: string; tokensIn: number; tokensOut: number }> {
  const prompt = buildSignalExtractionPrompt(context)

  // Try Gemini twice
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await extractStructured<{ signals: MarketSignal[] }>(
        prompt,
        SIGNAL_EXTRACTION_SCHEMA
      )
      if (result.signals && result.signals.length === 3) {
        return {
          signals: result.signals,
          modelUsed: "gemini-2.0-flash",
          tokensIn: estimateTokens(prompt),
          tokensOut: estimateTokens(JSON.stringify(result)),
        }
      }
    } catch (err) {
      console.warn(`[ai-analyst] Gemini extraction attempt ${attempt} failed:`, err)
      if (attempt < 2) {
        await sleep(1000)
      }
    }
  }

  // Fallback to Claude
  console.log("[ai-analyst] Falling back to Claude for signal extraction")
  try {
    const claudePrompt = `${prompt}\n\nReturn ONLY a JSON object with a "signals" array containing exactly 3 signal objects. Each signal must have: rank (1-3), signal (string), market (string), direction ("up"|"down"|"neutral"), confidence (0.0-1.0).`
    const response = await generateText(claudePrompt, { maxTokens: 1024 })
    const parsed = JSON.parse(response.text) as { signals: MarketSignal[] }
    return {
      signals: parsed.signals,
      modelUsed: "claude-sonnet-4-5/fallback",
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
    }
  } catch (err) {
    console.error("[ai-analyst] Claude fallback failed:", err)
    throw new Error("Signal extraction failed for both Gemini and Claude")
  }
}

function buildSignalExtractionPrompt(context: AnalystContext): string {
  const { positionReports, strataPrices, marketNews } = context

  let prompt = `You are a commodity market analyst. Extract the top 3 market signals from the data below.\n\n`

  prompt += `## Position Reports (${positionReports.length} rows)\n`
  positionReports.slice(0, 10).forEach((r) => {
    prompt += `- ${r.commodity}: ${r.position_lbs.toLocaleString()} lbs (week ${r.report_week})\n`
  })

  prompt += `\n## Strata Prices (${strataPrices.length} rows)\n`
  strataPrices.slice(0, 10).forEach((p) => {
    prompt += `- ${p.variety} ${p.size_grade || ""}: $${p.price_per_lb_usd}/lb (${p.snapshot_date})\n`
  })

  prompt += `\n## Market News (${marketNews.length} items)\n`
  marketNews.slice(0, 5).forEach((n) => {
    prompt += `- ${n.title} (${n.published_at})\n`
    if (n.summary) prompt += `  ${n.summary}\n`
  })

  prompt += `\n\nIdentify the top 3 price signals, demand trends, or anomalies. Rank them 1-3 by importance.`

  return prompt
}

// ---------------------------------------------------------------------------
// Step 4: Generate Brief (Claude)
// ---------------------------------------------------------------------------

export async function generateBrief(
  context: AnalystContext,
  signals: MarketSignal[]
): Promise<{ briefText: string; tokensIn: number; tokensOut: number }> {
  const prompt = buildBriefPrompt(context, signals)
  const response = await generateText(prompt, { maxTokens: 512 })
  return {
    briefText: response.text.trim(),
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
  }
}

function buildBriefPrompt(context: AnalystContext, signals: MarketSignal[]): string {
  const { positionReports, strataPrices, marketNews } = context

  let prompt = `You are a senior commodity trader's AI analyst. Write a 3-5 sentence executive brief for ${context.reportDate}.\n\n`

  prompt += `## Top Signals\n`
  signals.forEach((s) => {
    prompt += `${s.rank}. ${s.signal} (${s.market}, ${s.direction}, confidence ${s.confidence})\n`
  })

  prompt += `\n## Context\n`
  prompt += `Position reports: ${positionReports.length} rows\n`
  prompt += `Price data: ${strataPrices.length} rows\n`
  prompt += `News items: ${marketNews.length} items\n`

  if (positionReports.length > 0) {
    const topPos = positionReports[0]
    prompt += `\nTop position: ${topPos.commodity} at ${topPos.position_lbs.toLocaleString()} lbs\n`
  }

  if (strataPrices.length > 0) {
    const topPrice = strataPrices[0]
    prompt += `Latest price: ${topPrice.variety} at $${topPrice.price_per_lb_usd}/lb\n`
  }

  prompt += `\n\nWrite a concise, trader-ready brief. Focus on actionable insights. 3-5 sentences only.`

  return prompt
}

// ---------------------------------------------------------------------------
// Step 5: Upsert Analysis
// ---------------------------------------------------------------------------

export async function upsertAnalysis(analysis: AiAnalysisRow): Promise<void> {
  const { error } = await supabase.from("ai_analyses").upsert(
    {
      report_date: analysis.report_date,
      signals: analysis.signals as never,
      brief_text: analysis.brief_text,
      model_used: analysis.model_used,
      tokens_in: analysis.tokens_in,
      tokens_out: analysis.tokens_out,
      cost_usd: analysis.cost_usd,
    },
    { onConflict: "report_date" }
  )

  if (error) {
    throw new Error(`Failed to upsert ai_analyses: ${error.message}`)
  }

  console.log(`[ai-analyst] Upserted analysis for ${analysis.report_date}`)
}

// ---------------------------------------------------------------------------
// Step 6: Log Cost
// ---------------------------------------------------------------------------

export async function logCost(analysis: AiAnalysisRow): Promise<void> {
  const { error } = await supabase.from("atlas_cost_log").insert({
    agent_name: "adela/ai-analyst",
    model_id: analysis.model_used,
    tokens_in: analysis.tokens_in,
    tokens_out: analysis.tokens_out,
    cost_usd: analysis.cost_usd,
    context: `Daily brief for ${analysis.report_date}`,
  })

  if (error) {
    console.warn(`[ai-analyst] Failed to log cost: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export async function run(): Promise<RunResult> {
  console.log("[ai-analyst] Starting daily brief generation")

  // Step 1: Fetch data
  const data = await fetchData()
  if (data.positionReports.length === 0) {
    console.log("[ai-analyst] No position data available, skipping")
    return { status: "skipped", reason: "no_data" }
  }

  // Step 2: Build context
  const context = buildContext(data)

  // Step 3: Extract signals
  const { signals, modelUsed: signalModel, tokensIn: signalTokensIn, tokensOut: signalTokensOut } =
    await extractSignals(context)

  // Step 4: Generate brief
  const { briefText, tokensIn: briefTokensIn, tokensOut: briefTokensOut } = await generateBrief(
    context,
    signals
  )

  // Calculate total cost
  const totalTokensIn = signalTokensIn + briefTokensIn
  const totalTokensOut = signalTokensOut + briefTokensOut

  const signalCostIn = signalModel.includes("gemini")
    ? (signalTokensIn / 1_000_000) * GEMINI_COST_PER_1M_IN
    : (signalTokensIn / 1_000_000) * CLAUDE_COST_PER_1M_IN

  const signalCostOut = signalModel.includes("gemini")
    ? (signalTokensOut / 1_000_000) * GEMINI_COST_PER_1M_OUT
    : (signalTokensOut / 1_000_000) * CLAUDE_COST_PER_1M_OUT

  const briefCostIn = (briefTokensIn / 1_000_000) * CLAUDE_COST_PER_1M_IN
  const briefCostOut = (briefTokensOut / 1_000_000) * CLAUDE_COST_PER_1M_OUT

  const totalCost = signalCostIn + signalCostOut + briefCostIn + briefCostOut

  const analysis: AiAnalysisRow = {
    report_date: context.reportDate,
    signals,
    brief_text: briefText,
    model_used: `${signalModel} + claude-sonnet-4-5`,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: totalCost,
  }

  // Step 5: Upsert analysis
  await upsertAnalysis(analysis)

  // Step 6: Log cost
  await logCost(analysis)

  console.log(`[ai-analyst] Success: ${signals.length} signals, ${briefText.length} chars brief`)
  console.log(`[ai-analyst] Cost: $${totalCost.toFixed(6)}`)

  return { status: "success", analysis }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

if (require.main === module) {
  run()
    .then((result) => {
      console.log("[ai-analyst] Result:", result.status)
      process.exit(0)
    })
    .catch((err) => {
      console.error("[ai-analyst] Fatal error:", err)
      process.exit(1)
    })
}
