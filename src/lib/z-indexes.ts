// Phase 1.10z — central z-index hierarchy for floating UI.
//
// Use these constants instead of raw `z-N` Tailwind classes for any element
// that floats over page content. Keeps the stacking order auditable in one
// place so the DrAtlas FAB, PWA prompt, banners, and toasts can't fight.
//
// Higher number = closer to the user. Leave gaps so future surfaces can slot
// in without renumbering existing ones.

export const Z = {
  /** Inline page content (default) — explicit zero for clarity. */
  base: 0,
  /** Sticky page headers / table headers within a layout. */
  sticky: 10,
  /** Page-level overlays (mobile drawers, side sheets behind FAB). */
  overlay: 20,
  /** PWA install prompt — must sit below the FAB so the FAB can dismiss/cover. */
  pwaPrompt: 30,
  /** DrAtlasAssistant FAB. Always reachable, but doesn't trap pointer events. */
  fab: 40,
  /** DrAtlasAssistant modal backdrop + sheet. */
  fabModal: 45,
  /** Top-of-screen banners (migration, network, budget). */
  banner: 50,
  /** Toasts (transient confirmations + errors). */
  toast: 60,
  /** Critical modals (auth interception, destructive confirms). */
  criticalModal: 70,
} as const

export type ZIndexKey = keyof typeof Z
