import cron from "node-cron"
import { config } from "./config.js"
import { runAbcScraper } from "./scrapers/abc.js"

type ScraperFn = () => Promise<void>

interface Job {
  name: string
  schedule: string
  run: ScraperFn
}

const jobs: Job[] = [
  {
    name: "abc-position-reports",
    schedule: config.cron.abc,
    run: runAbcScraper,
  },
]

export function startScheduler(): void {
  for (const job of jobs) {
    cron.schedule(job.schedule, async () => {
      console.log(`[scheduler] Starting job: ${job.name}`)
      try {
        await job.run()
      } catch (err) {
        // Scraper functions should never throw, but this is the last safety net
        console.error(`[scheduler] Unhandled error in job ${job.name}:`, err)
      }
      console.log(`[scheduler] Finished job: ${job.name}`)
    })
    console.log(`[scheduler] Registered job: ${job.name} @ ${job.schedule}`)
  }
}
