// Lightweight, no-LLM intent classifier. The chat handler runs this BEFORE invoking
// Claude; if a high-confidence match fires, it injects a system-message hint suggesting
// the relevant tool. The LLM remains free to ignore the hint.

import type { ToolName } from './tools'

export interface IntentMatch {
  tool: ToolName
  reason: string
  confidence: number
  matched: string
}

interface IntentPattern {
  pattern: RegExp
  tool: ToolName
  reason: string
  confidence: number
}

const INTENT_PATTERNS: IntentPattern[] = [
  // Feature-request / spec-drafting intent — highest priority
  {
    pattern: /\b(build|ship|queue|draft|spec|open\s+phase)\b[^.\n]{0,80}\b(page|feature|service|widget|spec|task|component|tool|agent|module|table|migration|endpoint|panel|view)\b/i,
    tool: 'atlas.propose_and_queue',
    reason: 'feature-request intent',
    confidence: 0.85,
  },
  {
    pattern: /\bwe\s+need\s+(a|to)\s+(spec|build|ship|queue|draft)/i,
    tool: 'atlas.propose_and_queue',
    reason: 'we-need-feature intent',
    confidence: 0.80,
  },
  {
    pattern: /\b(can|could|should)\s+you\s+(build|ship|spec|queue|draft|open)\b/i,
    tool: 'atlas.propose_and_queue',
    reason: 'request-build intent',
    confidence: 0.80,
  },
  {
    pattern: /\bphase\s+\d+\.\d+[a-z]*\b.*\b(build|ship|queue|implement|do|start)\b/i,
    tool: 'atlas.propose_and_queue',
    reason: 'phase-numbered build intent',
    confidence: 0.85,
  },

  // Cancel
  {
    pattern: /\b(cancel|drop|kill|abort|remove)\b[^.\n]{0,40}\b(spec|task|queued)\b/i,
    tool: 'builder.cancel_task',
    reason: 'cancel-spec intent',
    confidence: 0.85,
  },

  // Status
  {
    pattern: /\b(status|how\s+are\s+things|where\s+are\s+we|progress|burn\s*rate|what\s+shipped|ship.*today)\b/i,
    tool: 'status.snapshot',
    reason: 'status-query intent',
    confidence: 0.70,
  },

  // Queue listing
  {
    pattern: /\b(what'?s?\s+queued|show\s+queue|list\s+queue|in\s+the\s+queue)\b/i,
    tool: 'builder.list_queue',
    reason: 'queue-listing intent',
    confidence: 0.85,
  },

  // Verifier
  {
    pattern: /\b(audit|verify|check.*commit|verifier)\b/i,
    tool: 'verifier.audit',
    reason: 'verify intent',
    confidence: 0.65,
  },

  // Adela / scrape
  {
    pattern: /\b(scrape|fetch.*data|trigger.*adela|run\s+adela)\b/i,
    tool: 'adela.trigger_scrape',
    reason: 'scrape intent',
    confidence: 0.70,
  },

  // Memory search
  {
    pattern: /\b(search|look\s*up|find|recall)\s+(memory|master\s+plan|docs|knowledge|adrs|audit)\b/i,
    tool: 'memory.search',
    reason: 'memory-search intent',
    confidence: 0.80,
  },

  // WhatsApp send
  {
    pattern: /\b(send\s+a?\s*whatsapp|notify\s+via\s+whatsapp|whatsapp\s+(me|him|her|the\s+team))\b/i,
    tool: 'whatsapp.send',
    reason: 'whatsapp-send intent',
    confidence: 0.85,
  },
]

export function detectIntent(message: string): IntentMatch | null {
  for (const p of INTENT_PATTERNS) {
    const m = message.match(p.pattern)
    if (m) {
      return {
        tool: p.tool,
        reason: p.reason,
        confidence: p.confidence,
        matched: m[0],
      }
    }
  }
  return null
}

export function buildIntentHint(intent: IntentMatch): string {
  return `[intent-hint] User message looks like ${intent.reason} (matched: "${intent.matched}", confidence ${intent.confidence.toFixed(2)}). Consider invoking the \`${intent.tool}\` tool. If details are unclear (e.g. unspecified phase number, ambiguous goal), ask the user a clarifying question before dispatching. This hint is advisory only — choose another tool if it fits better.`
}
