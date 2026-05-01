// Single-process git mutex (ported from atlas/src/lib/git-mutex.ts in 1.10af).
//
// Bug C (2026-05-01, phase-1.10ag): Designer's audit-commit handler runs
// `git fetch + checkout <head_after>` against /workspace/cropsintel-v3 before
// computing the diff. Multiple concurrent audits — or an audit running while
// the agent loop's own `git pull` fires — collide on `.git/index.lock` and
// fail with `Invalid revision range`, which previously caused Designer to
// silently fall back to a working-tree diff.
//
// All Designer code runs in the same Node process, so an in-memory promise
// chain is enough — no flock(2), no per-file lock file. Each call appends to
// the chain so git ops execute strictly serially. Errors don't poison the
// chain (we catch into `undefined`), so a failed fetch doesn't reject every
// subsequent caller.

let lockChain: Promise<unknown> = Promise.resolve()

export function withGitLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const next = lockChain.then(async () => {
    console.log(`[git-mutex] acquiring for ${label}`)
    const start = Date.now()
    try {
      const result = await fn()
      console.log(`[git-mutex] released ${label} after ${Date.now() - start}ms`)
      return result
    } catch (err) {
      console.error(`[git-mutex] released ${label} after error:`, err)
      throw err
    }
  })
  // Chain even on rejection so subsequent calls don't all reject.
  lockChain = next.catch(() => undefined)
  return next as Promise<T>
}
