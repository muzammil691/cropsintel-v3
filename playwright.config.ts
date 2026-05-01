// Phase 1.10ae — Playwright config for CropsIntel V3 E2E tests.
//
// Atlas vision smoke test (e2e/atlas-vision.spec.ts) is the first user. Phase 1.14
// will expand the suite. We deliberately keep this thin: one project (Chromium),
// the Vite dev server reused, and a 90s ceiling on each spec to enforce the
// success criterion.
//
// Env:
//   E2E_BASE_URL     — defaults to http://localhost:5173
//   E2E_ADMIN_EMAIL  — admin login for the auth bypass; spec skips if unset
//   E2E_ADMIN_PASSWORD

import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
})
