export const config = {
  abc: {
    indexUrl: "https://www.almonds.org/tools-and-resources/crop-reports/position-reports",
    baseUrl: "https://www.almonds.org",
    userAgent: "CropsIntel-Adela/1.0 (+https://cropsintel.com; market-intelligence-bot)",
    retryAttempts: 3,
    retryDelayMs: 2000,
  },

  cron: {
    // Phase 1.6a — Adela cadence per task spec
    abc: process.env.CRON_ABC ?? "*/15 * * * *",      // every 15 min
    strata: process.env.CRON_STRATA ?? "0 * * * *",   // top of every hour
    news: process.env.CRON_NEWS ?? "*/30 * * * *",    // every 30 min
  },

  scheduler: {
    // Max times the scheduler will retry a scraper run before dead-lettering
    // to scraper_errors. Each individual fetch in a scraper has its own retry
    // (fetchWithRetry); this is the outer retry around the whole run.
    maxAttempts: 3,
    retryDelayMs: 5000,
  },

  health: {
    port: parseInt(process.env.PORT ?? "8080", 10),
  },

  supabase: {
    storageBucket: "adela-raw",
    storagePrefix: "abc",
  },

  gemini: {
    model: "gemini-1.5-pro",
    maxRetries: 2,
  },
} as const
