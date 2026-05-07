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
      [key: string]: {
        Row: Record<string, unknown>
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
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
