export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_audit_log: {
        Row: {
          action_type: string
          agent_name: string
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          payload: Json
          result: Json | null
          status: string
          user_id: string | null
        }
        Insert: {
          action_type: string
          agent_name: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          status?: string
          user_id?: string | null
        }
        Update: {
          action_type?: string
          agent_name?: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          payload?: Json
          result?: Json | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      agent_rate_limits: {
        Row: {
          agent_name: string
          id: string
          last_request_at: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          agent_name: string
          id?: string
          last_request_at?: string
          request_count?: number
          user_id: string
          window_start: string
        }
        Update: {
          agent_name?: string
          id?: string
          last_request_at?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      canonical_products: {
        Row: {
          aliases: string[]
          commodity_id: string
          created_at: string
          description: string | null
          grade: string | null
          id: string
          is_active: boolean
          product_type: Database["public"]["Enums"]["product_type"]
          size: string | null
          updated_at: string
          variety: string
        }
        Insert: {
          aliases?: string[]
          commodity_id: string
          created_at?: string
          description?: string | null
          grade?: string | null
          id?: string
          is_active?: boolean
          product_type?: Database["public"]["Enums"]["product_type"]
          size?: string | null
          updated_at?: string
          variety: string
        }
        Update: {
          aliases?: string[]
          commodity_id?: string
          created_at?: string
          description?: string | null
          grade?: string | null
          id?: string
          is_active?: boolean
          product_type?: Database["public"]["Enums"]["product_type"]
          size?: string | null
          updated_at?: string
          variety?: string
        }
        Relationships: [
          {
            foreignKeyName: "canonical_products_commodity_id_fkey"
            columns: ["commodity_id"]
            isOneToOne: false
            referencedRelation: "commodities"
            referencedColumns: ["id"]
          },
        ]
      }
      commodities: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          slug: string
          trade_basis_options: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          slug: string
          trade_basis_options?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          slug?: string
          trade_basis_options?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          business_registration_number: string | null
          city: string | null
          company_type: Database["public"]["Enums"]["company_type"]
          country: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          primary_email: string | null
          primary_phone: string | null
          tax_id: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          verified_at: string | null
          verified_by: string | null
          website: string | null
        }
        Insert: {
          business_registration_number?: string | null
          city?: string | null
          company_type: Database["public"]["Enums"]["company_type"]
          country?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          primary_email?: string | null
          primary_phone?: string | null
          tax_id?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
        }
        Update: {
          business_registration_number?: string | null
          city?: string | null
          company_type?: Database["public"]["Enums"]["company_type"]
          country?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          primary_email?: string | null
          primary_phone?: string | null
          tax_id?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified_at?: string | null
          verified_by?: string | null
          website?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company_id: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_primary: boolean
          job_title: string | null
          notes: string | null
          phone: string | null
          preferred_language: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_primary?: boolean
          job_title?: string | null
          notes?: string | null
          phone?: string | null
          preferred_language?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_primary?: boolean
          job_title?: string | null
          notes?: string | null
          phone?: string | null
          preferred_language?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      market_intelligence: {
        Row: {
          ai_summary: string | null
          canonical_product_id: string | null
          commodity_id: string
          confidence: number | null
          created_at: string
          destination_country: string | null
          id: string
          ingested_at: string
          is_active: boolean
          occurred_at: string
          origin_country: string | null
          price_per_lb_usd: number | null
          quantity_lbs: number | null
          raw_payload: Json
          source: Database["public"]["Enums"]["intel_source"]
          source_attribution: string | null
          source_url: string | null
          trade_basis: string | null
        }
        Insert: {
          ai_summary?: string | null
          canonical_product_id?: string | null
          commodity_id: string
          confidence?: number | null
          created_at?: string
          destination_country?: string | null
          id?: string
          ingested_at?: string
          is_active?: boolean
          occurred_at: string
          origin_country?: string | null
          price_per_lb_usd?: number | null
          quantity_lbs?: number | null
          raw_payload?: Json
          source: Database["public"]["Enums"]["intel_source"]
          source_attribution?: string | null
          source_url?: string | null
          trade_basis?: string | null
        }
        Update: {
          ai_summary?: string | null
          canonical_product_id?: string | null
          commodity_id?: string
          confidence?: number | null
          created_at?: string
          destination_country?: string | null
          id?: string
          ingested_at?: string
          is_active?: boolean
          occurred_at?: string
          origin_country?: string | null
          price_per_lb_usd?: number | null
          quantity_lbs?: number | null
          raw_payload?: Json
          source?: Database["public"]["Enums"]["intel_source"]
          source_attribution?: string | null
          source_url?: string | null
          trade_basis?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "market_intelligence_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "canonical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_intelligence_commodity_id_fkey"
            columns: ["commodity_id"]
            isOneToOne: false
            referencedRelation: "commodities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string | null
          contact_id: string | null
          created_at: string
          display_name: string | null
          email_verified_at: string | null
          full_name: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          preferred_language: string
          primary_models: string[]
          tier: Database["public"]["Enums"]["user_tier"]
          updated_at: string
          whatsapp_number: string | null
          whatsapp_verified: boolean
        }
        Insert: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          email_verified_at?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          last_seen_at?: string | null
          preferred_language?: string
          primary_models?: string[]
          tier?: Database["public"]["Enums"]["user_tier"]
          updated_at?: string
          whatsapp_number?: string | null
          whatsapp_verified?: boolean
        }
        Update: {
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          display_name?: string | null
          email_verified_at?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          preferred_language?: string
          primary_models?: string[]
          tier?: Database["public"]["Enums"]["user_tier"]
          updated_at?: string
          whatsapp_number?: string | null
          whatsapp_verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      relationships: {
        Row: {
          company_id: string
          created_at: string
          established_at: string
          id: string
          is_active: boolean
          notes: string | null
          role: Database["public"]["Enums"]["relationship_role"]
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          company_id: string
          created_at?: string
          established_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          role: Database["public"]["Enums"]["relationship_role"]
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          company_id?: string
          created_at?: string
          established_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          role?: Database["public"]["Enums"]["relationship_role"]
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "relationships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_violations: {
        Row: {
          context: Json
          created_at: string
          decided_at: string | null
          decided_by: string | null
          description: string
          id: string
          severity: string
          user_decision: string | null
          violation_type: string
        }
        Insert: {
          context?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          description: string
          id?: string
          severity?: string
          user_decision?: string | null
          violation_type: string
        }
        Update: {
          context?: Json
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          description?: string
          id?: string
          severity?: string
          user_decision?: string | null
          violation_type?: string
        }
        Relationships: []
      }
      adela_runs: {
        Row: {
          id: string
          scraper: string
          started_at: string
          finished_at: string | null
          status: string
          rows_inserted: number | null
          rows_skipped: number | null
          error_message: string | null
          metadata: Json
        }
        Insert: {
          id?: string
          scraper: string
          started_at?: string
          finished_at?: string | null
          status?: string
          rows_inserted?: number | null
          rows_skipped?: number | null
          error_message?: string | null
          metadata?: Json
        }
        Update: {
          id?: string
          scraper?: string
          started_at?: string
          finished_at?: string | null
          status?: string
          rows_inserted?: number | null
          rows_skipped?: number | null
          error_message?: string | null
          metadata?: Json
        }
        Relationships: []
      }
      position_reports: {
        Row: {
          id: string
          commodity_id: string
          source: string
          report_date: string
          report_url: string
          raw_pdf_storage_path: string | null
          extracted: Json
          total_shipments_lbs: number | null
          total_inventory_lbs: number | null
          domestic_shipments_lbs: number | null
          export_shipments_lbs: number | null
          ingested_at: string
          ingested_by: string
        }
        Insert: {
          id?: string
          commodity_id: string
          source?: string
          report_date: string
          report_url: string
          raw_pdf_storage_path?: string | null
          extracted: Json
          total_shipments_lbs?: number | null
          total_inventory_lbs?: number | null
          domestic_shipments_lbs?: number | null
          export_shipments_lbs?: number | null
          ingested_at?: string
          ingested_by?: string
        }
        Update: {
          id?: string
          commodity_id?: string
          source?: string
          report_date?: string
          report_url?: string
          raw_pdf_storage_path?: string | null
          extracted?: Json
          total_shipments_lbs?: number | null
          total_inventory_lbs?: number | null
          domestic_shipments_lbs?: number | null
          export_shipments_lbs?: number | null
          ingested_at?: string
          ingested_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_reports_commodity_id_fkey"
            columns: ["commodity_id"]
            isOneToOne: false
            referencedRelation: "commodities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      zyra_conversations: {
        Row: {
          ai_provider: string | null
          channel: string
          confidence: number | null
          created_at: string
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          output_tokens: number | null
          session_id: string
          user_challenged: boolean
          user_id: string | null
          user_message: string
          was_escalated: boolean
          zyra_response: string
        }
        Insert: {
          ai_provider?: string | null
          channel?: string
          confidence?: number | null
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          session_id: string
          user_challenged?: boolean
          user_id?: string | null
          user_message: string
          was_escalated?: boolean
          zyra_response: string
        }
        Update: {
          ai_provider?: string | null
          channel?: string
          confidence?: number | null
          created_at?: string
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          session_id?: string
          user_challenged?: boolean
          user_id?: string | null
          user_message?: string
          was_escalated?: boolean
          zyra_response?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_team_or_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "auth" | "team" | "admin"
      company_type: "customer" | "broker" | "supplier" | "maxons_internal"
      intel_source:
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
      product_type:
        | "inshell"
        | "kernel"
        | "shelled"
        | "blanched"
        | "sliced"
        | "slivered"
        | "diced"
      relationship_role: "crm_customer" | "brm_broker" | "srm_supplier"
      user_tier: "guest" | "registered" | "verified" | "maxons_team"
      verification_status:
        | "unverified"
        | "pending_review"
        | "verified"
        | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["auth", "team", "admin"],
      company_type: ["customer", "broker", "supplier", "maxons_internal"],
      intel_source: [
        "abc_position_report",
        "abc_shipment",
        "abc_forecast",
        "abc_almanac",
        "usda_nass",
        "strata_pricing",
        "broker_note",
        "customer_indication",
        "supplier_offer",
        "news_article",
        "manual_entry",
        "ai_synthesis",
      ],
      product_type: [
        "inshell",
        "kernel",
        "shelled",
        "blanched",
        "sliced",
        "slivered",
        "diced",
      ],
      relationship_role: ["crm_customer", "brm_broker", "srm_supplier"],
      user_tier: ["guest", "registered", "verified", "maxons_team"],
      verification_status: [
        "unverified",
        "pending_review",
        "verified",
        "rejected",
      ],
    },
  },
} as const
