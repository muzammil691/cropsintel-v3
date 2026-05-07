/**
 * Scraper shared types and utilities
 *
 * Phase 1.6 architecture: each scraper (abc, strata, news) is a standalone
 * module exporting a run<Name>Scraper(): Promise<void> function. This module
 * provides shared types and utility functions used across scrapers.
 */

/**
 * Standard scraper function signature
 */
export type ScraperFunction = () => Promise<void>

/**
 * Scraper metadata for registration
 */
export interface ScraperMeta {
  name: string
  schedule: string
  run: ScraperFunction
}

/**
 * Common scraper result shape (for audit logging)
 */
export interface ScraperResult {
  rowsInserted: number
  rowsSkipped: number
  rowsFailed: number
  errorMessage?: string
}

/**
 * Retry configuration for fetch operations
 */
export interface RetryConfig {
  maxAttempts: number
  delayMs: number
  backoff?: boolean
}

/**
 * Sleep utility (used by retry logic)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generic retry wrapper for async operations
 * Used by scrapers for transient HTTP failures
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let attempt = 0
  let lastError: Error | null = null

  while (attempt < config.maxAttempts) {
    attempt++
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < config.maxAttempts) {
        const delay = config.backoff
          ? config.delayMs * attempt
          : config.delayMs
        await sleep(delay)
      }
    }
  }

  throw lastError || new Error("withRetry failed with unknown error")
}

/**
 * Extract domain from URL (used for audit logs)
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
