import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * Supabase client singleton for Adela service
 * Uses service key for admin-level access to scraping operations
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    'Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set'
  );
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const RETRY_BACKOFF_MULTIPLIER = 2;

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create Supabase client with service key
 */
function createSupabaseClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });
}

/**
 * Retry wrapper for Supabase operations
 * Handles transient network errors and rate limits
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string = 'Supabase operation'
): Promise<T> {
  let lastError: Error | null = null;
  let delay = RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      console.error(
        `[Adela Supabase] ${operationName} failed (attempt ${attempt}/${MAX_RETRIES}):`,
        error
      );

      // Don't retry on authentication errors or bad requests
      if (
        error instanceof Error &&
        (error.message.includes('JWT') ||
          error.message.includes('auth') ||
          error.message.includes('400'))
      ) {
        throw error;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < MAX_RETRIES) {
        console.log(`[Adela Supabase] Retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= RETRY_BACKOFF_MULTIPLIER;
      }
    }
  }

  throw new Error(
    `${operationName} failed after ${MAX_RETRIES} retries: ${lastError?.message}`
  );
}

/**
 * Singleton Supabase client instance
 * Export this for all Adela service operations
 */
export const supabase = createSupabaseClient();

/**
 * Health check function for monitoring
 */
export async function checkSupabaseHealth(): Promise<boolean> {
  try {
    const { error } = await withRetry(
      async () => supabase.from('scraper_runs').select('id').limit(1),
      'Health check'
    );

    if (error) {
      console.error('[Adela Supabase] Health check failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Adela Supabase] Health check exception:', error);
    return false;
  }
}
