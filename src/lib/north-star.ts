// CropsIntel V3 — North Star (master plan §1)
//
// Canonical TypeScript-side definitions of "what V3 is": the operating models
// used as an intelligence dimension, the pilot-commodity (almond) context, the
// three named layers, the multi-portal frontend taxonomy, and the explicit
// guardrails ("what V3 is NOT").
//
// Section 1.4 (the relationship-graph spine) is intentionally NOT duplicated
// here — it lives in `@/lib/relationship-graphs`.
//
// Why this file exists: the master plan says `primary_models` is a profile
// field with values from {A,B,C}, but neither the TS layer nor the verification
// form had a single source of truth for what those codes mean. Without this,
// each component invents its own labels (the verification form had wrong ones).

// -----------------------------------------------------------------------------
// 1. Operating models — §1.2
// -----------------------------------------------------------------------------
// V3 does NOT execute these models. V3 *understands* them so prescriptions and
// margin computations can be model-aware.

export type OperatingModelCode = "A" | "B" | "C"

export interface OperatingModel {
  code: OperatingModelCode
  label: string
  shortName: string
  description: string
}

export const OPERATING_MODELS: Record<OperatingModelCode, OperatingModel> = {
  A: {
    code: "A",
    label: "Model A — Back-to-back trading",
    shortName: "Back-to-back",
    description: "Customer-driven procurement. A confirmed customer order triggers the matching supplier purchase.",
  },
  B: {
    code: "B",
    label: "Model B — Speculative position trading",
    shortName: "Speculative",
    description: "Market-driven. Take a position based on a price view and resell into demand later.",
  },
  C: {
    code: "C",
    label: "Model C — Local stock & distribute",
    shortName: "Stock & distribute",
    description: "Dubai inventory model. Hold local stock and distribute on demand to regional buyers.",
  },
}

export const ALL_OPERATING_MODELS: OperatingModel[] = [
  OPERATING_MODELS.A,
  OPERATING_MODELS.B,
  OPERATING_MODELS.C,
]

export const OPERATING_MODEL_CODES: OperatingModelCode[] = ["A", "B", "C"]

export function operatingModelByCode(code: string): OperatingModel | null {
  return code === "A" || code === "B" || code === "C"
    ? OPERATING_MODELS[code]
    : null
}

/** Filters a free-form list of strings down to valid operating-model codes. */
export function normalizeOperatingModels(input: readonly string[]): OperatingModelCode[] {
  const seen = new Set<OperatingModelCode>()
  for (const v of input) {
    if (v === "A" || v === "B" || v === "C") seen.add(v)
  }
  return [...seen]
}

// -----------------------------------------------------------------------------
// 2. Pilot commodity + almond context — §1.3
// -----------------------------------------------------------------------------
// Almonds is the wedge. The schema is multi-commodity from Day 1 (every domain
// table has commodity_id). Adding pistachios = configuration, not a rewrite.

export const PILOT_COMMODITY_SLUG = "almonds" as const
export type PilotCommoditySlug = typeof PILOT_COMMODITY_SLUG

/** Almond varieties seeded in 20260428000001_v3_foundation.sql. */
export const ALMOND_VARIETIES = [
  "Nonpareil",
  "Carmel",
  "Independence",
  "Monterey",
  "Butte",
  "Padre",
] as const
export type AlmondVariety = (typeof ALMOND_VARIETIES)[number]

/** Mirrors the `product_type` Postgres enum. Each form has its own price ladder. */
export const ALMOND_FORMS = [
  "inshell",
  "kernel",
  "shelled",
  "blanched",
  "sliced",
  "slivered",
  "diced",
] as const
export type AlmondForm = (typeof ALMOND_FORMS)[number]

/** Mirrors `commodities.trade_basis_options` default. Incoterms used in deals. */
export const TRADE_BASES = ["FAS", "CIF", "FOB", "CFR", "DAP"] as const
export type TradeBasis = (typeof TRADE_BASES)[number]

/** Pricing convention defaults from the workflow doc (USD/lb, 50 lb cartons). */
export const PRICING_CONVENTION = {
  currency: "USD",
  unit: "lb",
  cartonWeightLb: 50,
  containerWeightLb: 44_000,
} as const

/**
 * Documents that appear in the almond export packet by destination context.
 * Phase 2's compliance reference module knows which docs apply per destination;
 * this is the global vocabulary.
 */
export const ALMOND_DOC_TYPES = [
  "phyto_usda",
  "certificate_of_origin",
  "usda_aflatoxin_cert",
  "halal_cert",
  "health_cert",
  "salmonella_cert_eu",
  "bill_of_lading",
  "packing_list",
  "commercial_invoice",
] as const
export type AlmondDocType = (typeof ALMOND_DOC_TYPES)[number]

// -----------------------------------------------------------------------------
// 3. Three named layers — §1.6 ("stable, do not rename")
// -----------------------------------------------------------------------------

export type NamedLayerCode = "adela" | "atlas" | "zyra"

export interface NamedLayer {
  code: NamedLayerCode
  label: string
  role: string
  /** Where the runtime artifact lives (master plan §9.2). */
  surface: "railway-service" | "supabase-edge-function" | "react-worker"
}

export const NAMED_LAYERS: Record<NamedLayerCode, NamedLayer> = {
  adela: {
    code: "adela",
    label: "Adela",
    role: "Runtime nervous system. Cron-driven Node process — monitors everything.",
    surface: "railway-service",
  },
  atlas: {
    code: "atlas",
    label: "Atlas",
    role: "Self-development / project-management layer. Council of 3-4 AI systems that debate.",
    surface: "supabase-edge-function",
  },
  zyra: {
    code: "zyra",
    label: "Zyra",
    role: "Customer-facing intelligence + sales co-worker + trade-lifecycle orchestrator.",
    surface: "supabase-edge-function",
  },
}

export const ALL_NAMED_LAYERS: NamedLayer[] = [
  NAMED_LAYERS.adela,
  NAMED_LAYERS.atlas,
  NAMED_LAYERS.zyra,
]

// -----------------------------------------------------------------------------
// 4. Multi-portal frontend — §1.7
// -----------------------------------------------------------------------------
// Every counterparty type logs into their own CropsIntel-branded portal. V3
// does NOT have separate portals for Maxons' 8 internal departments — those
// are MAXONS App's job.

export type PortalKind =
  | "public"
  | "subscriber"
  | "customer"
  | "broker"
  | "supplier"
  | "admin"

export interface PortalDefinition {
  kind: PortalKind
  label: string
  audience: string
  /** Phase a portal first ships in (master plan §11). */
  introducedInPhase: 1 | 3
}

export const PORTALS: Record<PortalKind, PortalDefinition> = {
  public: {
    kind: "public",
    label: "Public",
    audience: "Everyone — landing, market insight, news.",
    introducedInPhase: 1,
  },
  subscriber: {
    kind: "subscriber",
    label: "Subscriber",
    audience: "Verified users — full dashboards, Zyra deep chat, prescriptions, deal tracking, alerts.",
    introducedInPhase: 1,
  },
  customer: {
    kind: "customer",
    label: "Customer Portal",
    audience: "CRM-side. Order tracking for subscribers using CropsIntel-tracked offers.",
    introducedInPhase: 3,
  },
  broker: {
    kind: "broker",
    label: "Broker Portal",
    audience: "BRM-side. Deal pipeline, market notes submission, performance scorecard.",
    introducedInPhase: 3,
  },
  supplier: {
    kind: "supplier",
    label: "Supplier Portal",
    audience: "SRM-side. RFQ response, performance scorecard, market visibility.",
    introducedInPhase: 3,
  },
  admin: {
    kind: "admin",
    label: "Admin / CropsIntel team",
    audience: "Internal — content, users, feature flags, Atlas / Master Execution Plan.",
    introducedInPhase: 1,
  },
}

export const ALL_PORTALS: PortalDefinition[] = [
  PORTALS.public,
  PORTALS.subscriber,
  PORTALS.customer,
  PORTALS.broker,
  PORTALS.supplier,
  PORTALS.admin,
]

// -----------------------------------------------------------------------------
// 5. What V3 explicitly is NOT — §1.11
// -----------------------------------------------------------------------------
// Surfaced in code so the Scope Guardian (and any agent reasoning about scope)
// can compare a feature request against this list. If a request matches one of
// these patterns, the answer is "no" without further debate.

export interface ScopeGuardrail {
  rule: string
  rationale: string
  masterPlanRef: string
}

export const WHAT_V3_IS_NOT: ScopeGuardrail[] = [
  {
    rule: "V3 is not a Lovable app — V3 is local-first.",
    rationale: "Lovable's hosted dev loop is not the V3 build environment.",
    masterPlanRef: "§1.11",
  },
  {
    rule: "V3 does not default back to V1 if things go wrong. No DNS rollback.",
    rationale: "V1 stays in its current Lovable preview state as a historical artifact only.",
    masterPlanRef: "§1.11",
  },
  {
    rule: "V3 is not a parallel restart of V1.",
    rationale: "V3 inherits V1's depth and V2's scaffolding — fix in place, never park.",
    masterPlanRef: "§1.11 + §2.1",
  },
  {
    rule: "V3 is not a single-commodity build.",
    rationale: "Multi-commodity readiness is a Day 1 architectural constraint (commodity_id FK everywhere).",
    masterPlanRef: "§1.3 + §1.11",
  },
  {
    rule: "V3 is not the MAXONS App.",
    rationale: "Maxons builds the trading-execution app separately. V3 may integrate with it later.",
    masterPlanRef: "§1.1 + §1.11",
  },
  {
    rule: "V3 is not an accounting / payments / Business-Central replacement.",
    rationale: "BC is Maxons' financial system of record, integrated with MAXONS App, not V3.",
    masterPlanRef: "§1.1 + §1.11",
  },
  {
    rule: "V3 does not issue Sale Contracts, Purchase Contracts, or Shipping Instructions.",
    rationale: "Workflows 3, 4, 5 from the MAXONS doc are MAXONS App's job — V3 only uses them as knowledge.",
    masterPlanRef: "§1.8",
  },
  {
    rule: "V3 does not post anything to Business Central.",
    rationale: "BC posting is MAXONS App's job. V3 has zero BC integration.",
    masterPlanRef: "§1.8",
  },
  {
    rule: "V3 does not present bank documents or run LC / payment-instruction APIs.",
    rationale: "Payment execution is out of scope. V3 only coaches around payment patterns.",
    masterPlanRef: "§1.8",
  },
]

/**
 * Naive keyword check used by Atlas/Scope-Guardian style flows. Returns the
 * first matching guardrail or null. Callers should treat a match as "needs
 * explicit master-plan amendment, do not silently build."
 */
export function matchesScopeGuardrail(featureText: string): ScopeGuardrail | null {
  const text = featureText.toLowerCase()
  const triggers: { keywords: string[]; rule: string }[] = [
    { keywords: ["sale contract", "purchase contract", "shipping instruction"], rule: "Sale Contracts" },
    { keywords: ["business central", "bc post", "post to bc", "general ledger", "ap/ar"], rule: "Business-Central" },
    { keywords: ["letter of credit", " lc ", "bank document", "payment instruction api"], rule: "bank documents" },
    { keywords: ["dns rollback", "default back to v1", "rollback to v1"], rule: "DNS rollback" },
  ]
  for (const t of triggers) {
    if (t.keywords.some((k) => text.includes(k))) {
      return WHAT_V3_IS_NOT.find((g) => g.rule.toLowerCase().includes(t.rule.toLowerCase())) ?? null
    }
  }
  return null
}
