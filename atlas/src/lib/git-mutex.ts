// Single-process git mutex.
//
// Bug E + F (2026-05-01): the snapshot cron and the conductor heartbeat both
// run `git fetch + reset --hard origin/main` against the same /workspace clone
// every 5 min and collide on `.git/index.lock`. Atlas can't see the queue
// accurately until the lock clears.
//
// Since all Atlas code runs in the same Node process, an in-memory promise
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
