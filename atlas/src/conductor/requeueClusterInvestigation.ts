// Wraps the conductor's CLUSTER investigation enqueue with a hard cap on
// total re-queue attempts (phase-1.10bc).
//
// The cap-check must run synchronously before any enqueue: in production
// the zombie reaper can force-cancel an in-flight CLUSTER investigation,
// at which point the conductor would otherwise blindly enqueue a fresh
// one. Without this gate one cluster produced 6 specs back-to-back.
//
// Counts ALL existing specs across done/, cancelled/, queued/, and
// in-progress/ — never exclude a directory; a finished investigation
// still counts as an attempt against the cap.

import { countSpecsByTypeAndCluster } from '../utils/countSpecsByTypeAndCluster'
import { MAX_CLUSTER_INVESTIGATION_REQUEUES } from '../constants/investigationLimits'
import { sendClusterLoopCapAlert } from '../alerts/whatsapp'

export interface RequeueClusterInvestigationDeps {
  repoRoot: string
  clusterId: string
  enqueueSpec: () => Promise<void>
  countFn?: typeof countSpecsByTypeAndCluster
  alertFn?: typeof sendClusterLoopCapAlert
}

export type RequeueOutcome =
  | { status: 'enqueued' }
  | { status: 'capped'; existingCount: number }

export async function requeueClusterInvestigation(
  deps: RequeueClusterInvestigationDeps,
): Promise<RequeueOutcome> {
  const count = deps.countFn ?? countSpecsByTypeAndCluster
  const alert = deps.alertFn ?? sendClusterLoopCapAlert
  const existingCount = await count(deps.repoRoot, 'CLUSTER_INVESTIGATION', deps.clusterId)
  if (existingCount >= MAX_CLUSTER_INVESTIGATION_REQUEUES) {
    console.warn(
      `[conductor] CLUSTER investigation re-queue cap hit for cluster=${deps.clusterId} ` +
        `(${existingCount} existing specs >= ${MAX_CLUSTER_INVESTIGATION_REQUEUES}) — skipping enqueue`,
    )
    await alert(deps.clusterId)
    return { status: 'capped', existingCount }
  }
  await deps.enqueueSpec()
  return { status: 'enqueued' }
}
