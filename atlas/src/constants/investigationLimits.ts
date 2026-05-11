// Single source of truth for cluster-investigation re-queue caps. The
// zombie reaper can force-cancel a CLUSTER investigation spec at any time;
// without a cap the conductor would blindly re-queue forever (one incident
// spawned 6 specs for a single cluster — see phase-1.10bc).
//
// Counting policy: the cap is reached when total specs across done/ +
// cancelled/ + queued/ + in-progress/ for the same cluster is greater than
// or equal to this value. Two attempts is enough signal that something
// systemic is broken and a human needs to look.
export const MAX_CLUSTER_INVESTIGATION_REQUEUES = 2
