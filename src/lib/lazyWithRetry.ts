// 1.10bb-c Session 7 — chunk-load retry helper for `React.lazy`.
//
// Problem: when a fresh deploy lands on GitHub Pages, browser tabs that have
// the OLD index.html cached request asset hashes the new index doesn't list
// — or vice versa. The dynamic `import()` then throws TypeError /
// "Importing a module script failed" and React renders the
// AtlasCockpit ErrorBoundary's stock fallback. The cure is a one-time hard
// reload of the page to refetch the current index.html.
//
// Usage:
//   const Workshop = lazyWithRetry(
//     () => import('../atlas-plan/PlanWorkshop'),
//     'plan-workshop',
//   )
//
// First failure → reload. Second failure (after reload) → bubble the error
// to the parent ErrorBoundary so the user sees a real diagnosis instead of
// looping reloads. The `cacheKey` distinguishes chunks in sessionStorage so
// failures don't cross-cancel.

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const RELOAD_FLAG_PREFIX = 'lazy-retry:'

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const name = err instanceof Error ? err.name : ''
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Unable to preload CSS for/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  )
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  cacheKey: string,
): LazyExoticComponent<T> {
  const flag = `${RELOAD_FLAG_PREFIX}${cacheKey}`
  return lazy(async () => {
    try {
      const mod = await factory()
      // Success — clear the retry flag so future failures get one shot again.
      try { sessionStorage.removeItem(flag) } catch { /* private mode */ }
      return mod
    } catch (err) {
      if (!isChunkLoadError(err)) throw err

      // One reload per chunk per session. If we already reloaded and STILL
      // can't load, surface the real error so the boundary shows a useful
      // diagnostic + a manual reload button.
      let alreadyReloaded = false
      try { alreadyReloaded = sessionStorage.getItem(flag) === '1' } catch { /* ignore */ }
      if (alreadyReloaded) throw err
      try { sessionStorage.setItem(flag, '1') } catch { /* private mode */ }

      // Hard reload — clears in-memory module registry; service worker's
      // NetworkOnly rule on supabase/atlas means only static assets are
      // served from cache. `window.location.reload()` bypasses bfcache.
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
      // Block render until reload triggers — promise stays pending so React
      // shows the Suspense fallback rather than failing again.
      return new Promise<{ default: T }>(() => { /* never resolves */ })
    }
  })
}
