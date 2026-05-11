// Counts spec files of a given type for a given cluster across every
// terminal-and-active state directory the conductor cares about. Used by
// the re-queue cap-check so the conductor refuses to spawn a runaway loop
// of CLUSTER investigation specs (phase-1.10bc).
//
// Scanning is intentionally scoped to filenames that start with the
// type+cluster prefix so the cost stays O(matching files) rather than
// O(all specs in the four directories). Bodies are never read here.
//
// Known limitation: two conductor workers racing on the same cluster could
// both read count<cap and both enqueue, briefly exceeding the cap. The
// conductor is single-process today; if that ever changes, add a file lock
// or atomic DB counter around the count + enqueue.

import { readdir } from 'fs/promises'
import { join } from 'path'

export type SpecType = 'CLUSTER_INVESTIGATION'

const SPEC_TYPE_FILENAME_PREFIX: Record<SpecType, string> = {
  CLUSTER_INVESTIGATION: 'phase-1-CLUSTER-investigation-',
}

const STATE_DIRECTORIES = [
  '.agent/tasks/done',
  '.agent/tasks/cancelled',
  '.agent/tasks/queued',
  '.agent/tasks/in-progress',
] as const

export async function countSpecsByTypeAndCluster(
  repoRoot: string,
  specType: SpecType,
  clusterId: string,
): Promise<number> {
  const typePrefix = SPEC_TYPE_FILENAME_PREFIX[specType]
  const clusterPrefix = `${typePrefix}${clusterId}-`
  let total = 0
  for (const rel of STATE_DIRECTORIES) {
    const dir = join(repoRoot, rel)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      if (entry.startsWith(clusterPrefix)) {
        total += 1
      }
    }
  }
  return total
}
