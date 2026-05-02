// CropsIntel V3 — Three relationship graphs (the spine)
//
// Master plan ref: §1.4 — V3 has three scoped, separately-permissioned
// relationship graphs (CRM, BRM, SRM) with load-bearing information walls.
//
// This module is the canonical TypeScript-side definition of:
//   1. The three graphs (CRM, BRM, SRM) — what they are, who sits in them
//   2. The information walls — what each graph member is NOT allowed to see
//   3. Pure helpers usable from any layer (UI, edge functions, agents)
//   4. One async helper for resolving the calling user's graph membership
//
// Server-side agents (Zyra R1, CRM Intelligence R4, Quote Drafting R5, etc.)
// import the wall constants from here AND read information_walls from the DB
// (the table seeded by 20260502000000_relationship_graphs.sql); the DB row is
// authoritative at runtime, the TS constant is the source for the seed.

import { supabase } from "@/lib/supabase"
import type { CompanyType, RelationshipRole } from "@/lib/types"

// -----------------------------------------------------------------------------
// 1. Graph definitions
// -----------------------------------------------------------------------------

export type GraphCode = "CRM" | "BRM" | "SRM"

export interface GraphDefinition {
  code: GraphCode
  role: RelationshipRole
  companyType: CompanyType
  label: string
  description: string
  // What members of this graph are *primarily* permitted to see. This is the
  // positive framing; the negative framing (information walls) is below.
  primaryVisibility: string[]
}

export const GRAPHS: Record<GraphCode, GraphDefinition> = {
  CRM: {
    code: "CRM",
    role: "crm_customer",
    companyType: "customer",
    label: "Customers",
    description:
      "Importers and buyers across the world. See ONLY their own pricing — never supplier source, never broker source, never margin structure.",
    primaryVisibility: [
      "own_offers",
      "own_pricing",
      "public_market_intelligence",
      "own_inquiry_status",
      "own_documents",
    ],
  },
  BRM: {
    code: "BRM",
    role: "brm_broker",
    companyType: "broker",
    label: "Brokers",
    description:
      "Intermediaries who connect buyers and sellers. See market intelligence + commission opportunities on deals they intermediate.",
    primaryVisibility: [
      "public_market_intelligence",
      "intermediated_deal_summaries",
      "own_commission_terms",
      "broker_performance_scorecard",
    ],
  },
  SRM: {
    code: "SRM",
    role: "srm_supplier",
    companyType: "supplier",
    label: "Suppliers",
    description:
      "Growers, hullers, processors — primarily US almond sources. See pricing/demand signals to maximize their own profit.",
    primaryVisibility: [
      "public_market_intelligence",
      "demand_signals",
      "own_offer_pipeline",
      "supplier_performance_scorecard",
    ],
  },
}

export const ALL_GRAPHS: GraphDefinition[] = [GRAPHS.CRM, GRAPHS.BRM, GRAPHS.SRM]

// -----------------------------------------------------------------------------
// 2. Information walls — load-bearing (master plan §1.4)
// -----------------------------------------------------------------------------
// "The AI enforces every wall autonomously. Any feature that breaches a wall
//  is automatically out of scope."
//
// Mirrors the seed data inserted by 20260502000000_relationship_graphs.sql so
// agents can fall back to TS constants if the table is unreachable. If you
// add a wall here, also add it to the migration's seed block.

export type WallSeverity = "block" | "redact"

export interface InformationWall {
  viewerRole: RelationshipRole
  forbiddenCategory: string
  description: string
  severity: WallSeverity
}

export const INFORMATION_WALLS: InformationWall[] = [
  // CRM (customers): see ONLY their own pricing
  {
    viewerRole: "crm_customer",
    forbiddenCategory: "supplier_identity",
    description: "Customers must never see which supplier sourced their product.",
    severity: "block",
  },
  {
    viewerRole: "crm_customer",
    forbiddenCategory: "broker_identity",
    description: "Customers must never see which broker intermediated the deal.",
    severity: "block",
  },
  {
    viewerRole: "crm_customer",
    forbiddenCategory: "margin_structure",
    description: "Customers must never see Maxons margin, landed cost, or cost basis.",
    severity: "block",
  },
  {
    viewerRole: "crm_customer",
    forbiddenCategory: "other_customer_pricing",
    description: "Customers must never see pricing offered to any other customer.",
    severity: "block",
  },
  {
    viewerRole: "crm_customer",
    forbiddenCategory: "supplier_offer_price",
    description:
      "Customers must never see raw supplier offer prices — only their own quoted price.",
    severity: "block",
  },

  // BRM (brokers): see market intelligence + commission opportunities
  {
    viewerRole: "brm_broker",
    forbiddenCategory: "customer_identity_unless_shared",
    description:
      "Brokers see customer identity only on deals they themselves intermediated.",
    severity: "redact",
  },
  {
    viewerRole: "brm_broker",
    forbiddenCategory: "maxons_internal_margin",
    description: "Brokers must never see Maxons internal margin structure.",
    severity: "block",
  },
  {
    viewerRole: "brm_broker",
    forbiddenCategory: "other_broker_commissions",
    description:
      "Brokers must never see commission terms granted to other brokers.",
    severity: "block",
  },

  // SRM (suppliers): see pricing/demand to maximize their profit
  {
    viewerRole: "srm_supplier",
    forbiddenCategory: "customer_identity",
    description: "Suppliers must never see end-customer identity for non-direct deals.",
    severity: "block",
  },
  {
    viewerRole: "srm_supplier",
    forbiddenCategory: "maxons_resale_price",
    description: "Suppliers must never see Maxons resale price downstream.",
    severity: "block",
  },
  {
    viewerRole: "srm_supplier",
    forbiddenCategory: "broker_identity",
    description:
      "Suppliers must never see which broker is involved in the downstream sale.",
    severity: "redact",
  },
  {
    viewerRole: "srm_supplier",
    forbiddenCategory: "other_supplier_offers",
    description: "Suppliers must never see competing supplier offers.",
    severity: "block",
  },
]

// -----------------------------------------------------------------------------
// 3. Pure helpers (no DB access)
// -----------------------------------------------------------------------------

export function graphForRole(role: RelationshipRole): GraphDefinition {
  switch (role) {
    case "crm_customer":
      return GRAPHS.CRM
    case "brm_broker":
      return GRAPHS.BRM
    case "srm_supplier":
      return GRAPHS.SRM
  }
}

export function graphForCompanyType(
  type: CompanyType,
): GraphDefinition | null {
  switch (type) {
    case "customer":
      return GRAPHS.CRM
    case "broker":
      return GRAPHS.BRM
    case "supplier":
      return GRAPHS.SRM
    case "maxons_internal":
      return null
  }
}

/**
 * Returns every wall that applies to the given role. Used by Zyra and the
 * CRM Intelligence Agent to filter context before sending it to the LLM.
 */
export function wallsForRole(role: RelationshipRole): InformationWall[] {
  return INFORMATION_WALLS.filter((w) => w.viewerRole === role)
}

/**
 * `true` if the named category is forbidden for the given role. Agents call
 * this before deciding whether to include a field in a response.
 */
export function isCategoryForbidden(
  role: RelationshipRole,
  category: string,
): boolean {
  return INFORMATION_WALLS.some(
    (w) => w.viewerRole === role && w.forbiddenCategory === category,
  )
}

/**
 * Returns the severity of the wall blocking `category` for `role`, or `null`
 * if the category is permitted. Agents that get `'redact'` should replace the
 * field with a placeholder; `'block'` means refuse to answer.
 */
export function wallSeverity(
  role: RelationshipRole,
  category: string,
): WallSeverity | null {
  const wall = INFORMATION_WALLS.find(
    (w) => w.viewerRole === role && w.forbiddenCategory === category,
  )
  return wall?.severity ?? null
}

// -----------------------------------------------------------------------------
// 4. Async helper — resolve the calling user's graph membership
// -----------------------------------------------------------------------------
// Mirrors the user_company_role(uuid) Postgres function so callers that don't
// want to round-trip an RPC can do it client-side. RLS keeps this honest:
// non-maxons users only see their own profile/company/relationship rows.

export interface UserGraphMembership {
  userId: string
  companyId: string | null
  companyType: CompanyType | null
  graph: GraphDefinition | null
  graphVerified: boolean
}

export async function getUserGraphMembership(
  userId: string,
): Promise<UserGraphMembership> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, company_id")
    .eq("id", userId)
    .maybeSingle()

  if (profileError || !profile) {
    return {
      userId,
      companyId: null,
      companyType: null,
      graph: null,
      graphVerified: false,
    }
  }

  if (!profile.company_id) {
    return {
      userId,
      companyId: null,
      companyType: null,
      graph: null,
      graphVerified: false,
    }
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id, company_type")
    .eq("id", profile.company_id)
    .maybeSingle()

  const { data: relationship } = await supabase
    .from("relationships")
    .select("role, verification_status, is_active")
    .eq("company_id", profile.company_id)
    .eq("is_active", true)
    .maybeSingle()

  const graph = relationship
    ? graphForRole(relationship.role)
    : company
      ? graphForCompanyType(company.company_type)
      : null

  return {
    userId,
    companyId: profile.company_id,
    companyType: company?.company_type ?? null,
    graph,
    graphVerified: relationship?.verification_status === "verified",
  }
}
