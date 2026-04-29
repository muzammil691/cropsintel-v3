export const config = {
  abc: {
    indexUrl: "https://www.almonds.org/tools-and-resources/crop-reports/position-reports",
    baseUrl: "https://www.almonds.org",
    userAgent: "CropsIntel-Adela/1.0 (+https://cropsintel.com; market-intelligence-bot)",
    retryAttempts: 3,
    retryDelayMs: 2000,
  },

  cron: {
    // Daily at 06:00 UTC — buffer after ABC's typical morning publish
    abc: "0 6 * * *",
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
