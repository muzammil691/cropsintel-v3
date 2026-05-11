// Unit tests for the cluster-investigation re-queue cap (phase-1.10bc).
// Verifies:
//  - happy path: count below cap → enqueue once, no alert
//  - cap hit:    count at cap   → enqueue skipped, alert sent exactly once

import { describe, it, expect, vi } from 'vitest'
import { requeueClusterInvestigation } from '../requeueClusterInvestigation'
import { MAX_CLUSTER_INVESTIGATION_REQUEUES } from '../../constants/investigationLimits'

describe('requeueClusterInvestigation', () => {
  const repoRoot = '/tmp/fake-repo'
  const clusterId = 'abc123def456'

  it('enqueues when existing spec count is below the cap and does not alert', async () => {
    const countFn = vi.fn().mockResolvedValue(MAX_CLUSTER_INVESTIGATION_REQUEUES - 1)
    const alertFn = vi.fn().mockResolvedValue(undefined)
    const enqueueSpec = vi.fn().mockResolvedValue(undefined)

    const out = await requeueClusterInvestigation({
      repoRoot,
      clusterId,
      enqueueSpec,
      countFn,
      alertFn,
    })

    expect(out).toEqual({ status: 'enqueued' })
    expect(enqueueSpec).toHaveBeenCalledTimes(1)
    expect(alertFn).not.toHaveBeenCalled()
    expect(countFn).toHaveBeenCalledWith(repoRoot, 'CLUSTER_INVESTIGATION', clusterId)
  })

  it('skips enqueue and sends a single alert when the cap is reached', async () => {
    const countFn = vi.fn().mockResolvedValue(MAX_CLUSTER_INVESTIGATION_REQUEUES)
    const alertFn = vi.fn().mockResolvedValue(undefined)
    const enqueueSpec = vi.fn().mockResolvedValue(undefined)

    const out = await requeueClusterInvestigation({
      repoRoot,
      clusterId,
      enqueueSpec,
      countFn,
      alertFn,
    })

    expect(out).toEqual({
      status: 'capped',
      existingCount: MAX_CLUSTER_INVESTIGATION_REQUEUES,
    })
    expect(enqueueSpec).not.toHaveBeenCalled()
    expect(alertFn).toHaveBeenCalledTimes(1)
    expect(alertFn).toHaveBeenCalledWith(clusterId)
  })

  it('skips enqueue and alerts when count exceeds the cap', async () => {
    const countFn = vi.fn().mockResolvedValue(MAX_CLUSTER_INVESTIGATION_REQUEUES + 3)
    const alertFn = vi.fn().mockResolvedValue(undefined)
    const enqueueSpec = vi.fn().mockResolvedValue(undefined)

    const out = await requeueClusterInvestigation({
      repoRoot,
      clusterId,
      enqueueSpec,
      countFn,
      alertFn,
    })

    expect(out.status).toBe('capped')
    expect(enqueueSpec).not.toHaveBeenCalled()
    expect(alertFn).toHaveBeenCalledTimes(1)
  })
})
