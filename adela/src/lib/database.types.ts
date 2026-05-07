/**
 * Auto-generated Supabase types for Adela service
 *
 * Generate with:
 * npx supabase gen types typescript --project-id $SUPABASE_PROJECT_REF > src/lib/database.types.ts
 *
 * This is a placeholder until types are generated from the actual V3 schema
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      scraper_runs: {
        Row: {
          id: string
          created_at: string
          scraper_name: string
          status: string
          error_message: string | null
          records_scraped: number
          started_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          scraper_name: string
          status: string
          error_message?: string | null
          records_scraped?: number
          started_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          scraper_name?: string
          status?: string
          error_message?: string | null
          records_scraped?: number
          started_at?: string
          completed_at?: string | null
        }
      }
      position_reports: {
        Row: {
          id: string
          commodity: string
          position_lbs: number
          report_date: string
          report_week: string
          created_at: string
        }
        Insert: {
          id?: string
          commodity: string
          position_lbs: number
          report_date: string
          report_week: string
          created_at?: string
        }
        Update: {
          id?: string
          commodity?: string
          position_lbs?: number
          report_date?: string
          report_week?: string
          created_at?: string
        }
      }
      ai_analyses: {
        Row: {
          id: string
          analysis_date: string
          model_used: string
          input_data: Json
          signals: Json
          brief: string
          confidence_score: number
          created_at: string
        }
        Insert: {
          id?: string
          analysis_date: string
          model_used: string
          input_data?: Json
          signals: Json
          brief: string
          confidence_score: number
          created_at?: string
        }
        Update: {
          id?: string
          analysis_date?: string
          model_used?: string
          input_data?: Json
          signals?: Json
          brief?: string
          confidence_score?: number
          created_at?: string
        }
      }
      atlas_dispatches: {
        Row: {
          id: string
          event: string
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          event: string
          payload: Json
          created_at?: string
        }
        Update: {
          id?: string
          event?: string
          payload?: Json
          created_at?: string
        }
      }
      atlas_cost_log: {
        Row: {
          id: string
          agent_name: string
          model_id: string
          tokens_in: number
          tokens_out: number
          cost_usd: number
          context: string | null
          created_at: string
        }
        Insert: {
          id?: string
          agent_name: string
          model_id: string
          tokens_in: number
          tokens_out: number
          cost_usd: number
          context?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          agent_name?: string
          model_id?: string
          tokens_in?: number
          tokens_out?: number
          cost_usd?: number
          context?: string | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
