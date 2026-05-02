export const config = {
  abc: {
    indexUrl: "https://www.almonds.org/tools-and-resources/crop-reports/position-reports",
    baseUrl: "https://www.almonds.org",
    userAgent: "CropsIntel-Adela/1.0 (+https://cropsintel.com; market-intelligence-bot)",
    retryAttempts: 3,
    retryDelayMs: 2000,
  },

  cron: {
    // Phase 1.00e-rem — abc runs once daily at 06:00 UTC (ABC posts the
    // monthly position report overnight US time, so 06:00 UTC is well after
    // it lands). Strata + news still run on their faster cadences.
    abc: process.env.CRON_ABC ?? "0 6 * * *",         // 06:00 UTC daily
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
    // gemini-1.5-pro returned 404 from v1beta in May 2026; current default is
    // gemini-2.0-flash. Override via GEMINI_MODEL env var.
    model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    maxRetries: 2,
  },
} as const
