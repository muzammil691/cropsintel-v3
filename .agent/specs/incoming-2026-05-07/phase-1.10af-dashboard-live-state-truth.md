---
phase: 1.10af
title: Dashboard live state truth — kill stale UI rendering
status: planned
gate: in-progress count <= 2 AND phase 1.10ae shipped
order: 2-of-4
estimated_builder_minutes: 90
estimated_cost_usd: 3
master_plan_section: 11.7
---

# Phase 1.10af — Dashboard live state truth

## Why this exists

The dashboard lies in three observed ways:

1. **Force-cancel button:** user clicks → API succeeds → file moves to `cancelled/` on disk → but the dashboard still shows the spec in `in-progress/` until manual page refresh. User assumes button broken, clicks again, gets `400 not found`, panics.

2. **Builder elapsed timer:** Queue tab shows "Builder is on phase-X (128 min in)" even when Builder has actually crashed and isn't doing anything. The timer ticks based on local browser clock, not on real Builder activity.

3. **Mode badge:** Even after fixing trust-mode persistence in 1.10ae, the badge may show stale state if the dashboard caches the old mode locally and never re-fetches.

These are all symptoms of the same root cause: **the dashboard renders cached/optimistic state instead of polling truth from the backend.**

## Foundation-first check

- ✅ `1.10ae` shipped first (mode persistence works at API layer).
- ✅ `src/components/atlas/tabs/AtlasQueueTab.tsx` exists.
- ✅ `src/components/atlas/AtlasHeader.tsx` (or equivalent) holds the mode badge.
- ✅ `src/lib/atlas-client.ts` has `forceCancelBuilderTask`, `fetchQueue`, `fetchAtlasMode`.

## What ships

### 1. Queue tab — auto-poll every 5 seconds

`AtlasQueueTab.tsx` currently fetches once on mount. Change to:

```typescript
useEffect(() => {
  const fetchAndSchedule = async () => {
    await refetchQueue()
  }
  fetchAndSchedule()
  const interval = setInterval(fetchAndSchedule, 5000)
  return () => clearInterval(interval)
}, [])
```

Also: pause polling when document is hidden (`document.visibilityState !== 'visible'`) to avoid burning API on background tabs. Resume on visibility change.

### 2. Force-cancel handler — refetch on success

In `AtlasQueueTab.tsx` `handleForceCancel`:

```typescript
const handleForceCancel = async (taskId) => {
  try {
    await forceCancelBuilderTask(taskId)
    await refetchQueue()  // <-- add this line
    toast.success(`Cancelled ${taskId}`)
  } catch (e) {
    toast.error(`Cancel failed: ${e.message}`)
    await refetchQueue()  // also refetch on failure — spec may have already moved
  }
}
```

### 3. Builder elapsed timer — show truth, not local clock

In `AtlasQueueTab.tsx`, the "(128 min in)" string is currently computed as `Date.now() - startTime`. Change to:

- The `/atlas/builder/queue` API response includes `builder_last_heartbeat_at` (added in 1.10ag).
- If `(now - builder_last_heartbeat_at) > 120s`, render the spec card with a red border and the text `"Builder unresponsive — last seen Nm ago"` instead of `"running Nm in"`.
- If heartbeat is fresh (≤120s), show `"running Nm in"` as today.

Until 1.10ag ships, fall back to: if the spec has been `in-progress` for >30min AND no commits to GitHub touched its log file in last 10min, show "Builder may be stuck" warning.

### 4. Mode badge — always polls API, never trusts local state

In `AtlasHeader.tsx` (the component holding the mode badge):

```typescript
useEffect(() => {
  const refetch = async () => {
    const { mode } = await fetchAtlasMode()
    setMode(mode)
  }
  refetch()
  const interval = setInterval(refetch, 10000)
  return () => clearInterval(interval)
}, [])
```

Mode toggle handler:

```typescript
const handleModeChange = async (newMode) => {
  setIsChanging(true)
  try {
    const result = await setAtlasMode(newMode)
    setMode(result.mode)  // Use server's confirmed mode, not the requested mode
    toast.success(`Mode: ${result.mode}`)
  } catch (e) {
    toast.error(`Mode change failed: ${e.message}`)
    // Don't optimistically update — leave at previous server-confirmed value
  } finally {
    setIsChanging(false)
  }
}
```

Show a small spinner overlay on the badge while `isChanging`.

### 5. Stale-state warning banner

If the dashboard fails to reach `/atlas/queue` for >30 seconds (e.g., Atlas down), show a global red banner at top: `"Dashboard cannot reach Atlas — showing stale data from <timestamp>"`. This makes it impossible to mistake stale state for current state.

### 6. Tests

`e2e/dashboard-truth.spec.ts`:

- (a) Mock force-cancel API success → click button → assert spec disappears from queue list within 6 seconds (5s poll + 1s buffer).
- (b) Mock mode API to return 500 → click toggle → assert mode badge does NOT change AND error toast appears.
- (c) Mock `/atlas/queue` to be unreachable → assert red banner appears within 35 seconds.

## Acceptance criteria

- Queue tab updates within 5s when a spec is force-cancelled (no manual refresh needed).
- Mode badge persists across page refresh (regression test for 1.10ae).
- When Atlas is unreachable, a red banner is visible — no silent stale state.
- Background-tab polling pauses (verify in DevTools Network tab: no requests when tab is hidden).
- `npm run build` passes.
- `npx playwright test e2e/dashboard-truth.spec.ts` green.

## Out of scope

- Real-time push notifications (WebSocket) — polling is fine for this load.
- Partial queue updates (we re-fetch the whole queue every 5s; the queue is small enough).
- Plan tab polling (separate concern; covered by 1.10aa later).

## Dependencies

- 1.10ae shipped.
- 1.10ag NOT required to be shipped (this spec gracefully degrades without `builder_last_heartbeat_at`).
