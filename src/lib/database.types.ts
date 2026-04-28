// CropsIntel V3 — Database types
//
// HAND-WRITTEN TYPES MATCHING THE FOUNDATION MIGRATION
// (supabase/migrations/20260428000001_v3_foundation.sql)
//
// In Phase 1 sub-task 1.4 we replace this file with auto-generated types via:
//   npx supabase gen types typescript --project-id hzrnohsxigrqlmzegwlb > src/lib/database.types.ts
//
// Until then, these hand-written types let the Supabase client be typed correctly
// for the foundation tables.

export type AppRole = "auth" | "team" | "admin"
export type CompanyType = "customer" | "broker" | "supplier" | "maxons_internal"
export type VerificationStatus = "unverified" | "pending_review" | "verified" | "rejected"
export type ProductType = "inshell" | "kernel" | "shelled" | "blanched" | "sliced" | "slivered" | "diced"
export type UserTier = "guest" | "registered" | "verified" | "maxons_team"
export type RelationshipRole = "crm_customer" | "brm_broker" | "srm_supplier"
export type IntelSource =
  | "abc_position_report"
  | "abc_shipment"
  | "abc_forecast"
  | "abc_almanac"
  | "usda_nass"
  | "strata_pricing"
  | "broker_note"
  | "customer_indication"
  | "supplier_offer"
  | "news_article"
  | "manual_entry"
  | "ai_synthesis"

export type Commodity = {
  id: string
  slug: string
  display_name: string
  trade_basis_options: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Company = {
  id: string
  name: string
  company_type: CompanyType
  country: string | null
  city: string | null
  website: string | null
  primary_email: string | null
  primary_phone: string | null
  business_registration_number: string | null
  tax_id: string | null
  verification_status: VerificationStatus
  verified_at: string | null
  verified_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type Contact = {
  id: string
  company_id: string
  full_name: string
  job_title: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  is_primary: boolean
  preferred_language: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type CanonicalProduct = {
  id: string
  commodity_id: string
  variety: string
  product_type: ProductType
  size: string | null
  grade: string | null
  description: string | null
  aliases: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Profile = {
  id: string
  contact_id: string | null
  company_id: string | null
  full_name: string | null
  display_name: string | null
  preferred_language: string
  tier: UserTier
  primary_models: string[]
  whatsapp_number: string | null
  whatsapp_verified: boolean
  email_verified_at: string | null
  last_seen_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Relationship = {
  id: string
  company_id: string
  role: RelationshipRole
  verification_status: VerificationStatus
  is_active: boolean
  notes: string | null
  established_at: string
  created_at: string
  updated_at: string
}

export type MarketIntelligence = {
  id: string
  commodity_id: string
  canonical_product_id: string | null
  source: IntelSource
  source_url: string | null
  source_attribution: string | null
  occurred_at: string
  ingested_at: string
  origin_country: string | null
  destination_country: string | null
  trade_basis: string | null
  price_per_lb_usd: number | null
  quantity_lbs: number | null
  raw_payload: Record<string, unknown>
  ai_summary: string | null
  confidence: number | null
  is_active: boolean
  created_at: string
}

export type ZyraConversation = {
  id: string
  user_id: string | null
  session_id: string
  channel: string
  user_message: string
  zyra_response: string
  ai_provider: string | null
  input_tokens: number | null
  output_tokens: number | null
  estimated_cost_usd: number | null
  confidence: number | null
  was_escalated: boolean
  user_challenged: boolean
  created_at: string
}

export type UserRole = {
  id: string
  user_id: string
  role: AppRole
  granted_at: string
  granted_by: string | null
}

// Minimal Database type shape for the typed Supabase client.
// Phase 1.4 replaces this with the auto-generated full schema.
export type Database = {
  public: {
    Tables: {
      commodities: { Row: Commodity; Insert: Partial<Commodity>; Update: Partial<Commodity> }
      companies: { Row: Company; Insert: Partial<Company>; Update: Partial<Company> }
      contacts: { Row: Contact; Insert: Partial<Contact>; Update: Partial<Contact> }
      canonical_products: { Row: CanonicalProduct; Insert: Partial<CanonicalProduct>; Update: Partial<CanonicalProduct> }
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> }
      relationships: { Row: Relationship; Insert: Partial<Relationship>; Update: Partial<Relationship> }
      market_intelligence: { Row: MarketIntelligence; Insert: Partial<MarketIntelligence>; Update: Partial<MarketIntelligence> }
      zyra_conversations: { Row: ZyraConversation; Insert: Partial<ZyraConversation>; Update: Partial<ZyraConversation> }
      user_roles: { Row: UserRole; Insert: Partial<UserRole>; Update: Partial<UserRole> }
    }
    Views: Record<string, never>
    Functions: {
      has_role: { Args: { _user_id: string; _role: AppRole }; Returns: boolean }
      is_team_or_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: AppRole
      company_type: CompanyType
      verification_status: VerificationStatus
      product_type: ProductType
      user_tier: UserTier
      relationship_role: RelationshipRole
      intel_source: IntelSource
    }
  }
}
