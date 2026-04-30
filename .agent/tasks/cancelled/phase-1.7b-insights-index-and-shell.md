# Task: Phase 1.7b — Insights index page + subscriber app shell

**Master plan reference:** §11.2 row 1.7; §1.7 Subscriber portal layout.
**Context:** Phase 1.7a builds the Position Reports page. This spec builds the surrounding navigation: a `/insights` index page that lists all market intelligence pages (currently just position reports; price intelligence in 1.8; news in 1.8b) and a subscriber-side app shell with sidebar navigation that wraps every authenticated route.
**Estimated effort:** ~50 min Builder time
**Model:** claude-opus-4-7 (UI quality matters)

model: claude-opus-4-7

---

## Goal

1. Replace the `<NotImplemented phase="1.50-landing-real" />` placeholder at `/insights` with a real index page listing all market-intelligence sub-pages
2. Add a `SubscriberShell` layout component (sidebar + header + main) that wraps `/dashboard`, `/insights/*`, and any future subscriber routes
3. Sidebar items (Phase 1 scope):
   - Dashboard (home)
   - Insights → Position Reports / Price Intelligence (placeholder until 1.8) / News (placeholder until 1.8b)
   - Settings (placeholder)
   - Sign out
4. Mobile: collapsible drawer; desktop: persistent 240 px sidebar

## Architecture

```
src/
├── components/
│   └── layouts/
│       ├── SubscriberShell.tsx    (NEW)
│       └── SubscriberSidebar.tsx  (NEW)
├── pages/
│   └── insights/
│       ├── PositionReports.tsx    (1.7a)
│       └── InsightsIndex.tsx      (NEW)
└── App.tsx                         (extend)
```

`SubscriberShell` uses React Router `Outlet` for child route rendering. Apply via nested route configuration:

```tsx
<Route element={<RouteGuard requires="auth"><SubscriberShell /></RouteGuard>}>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/insights" element={<InsightsIndex />} />
  <Route path="/insights/position-reports" element={<PositionReports />} />
</Route>
```

## Design tokens

Mirror Atlas dashboard's quality bar:
- Sidebar: `border-r bg-card`
- Active item: `bg-accent text-accent-foreground`
- Hover: `hover:bg-muted/60 transition-colors`
- Icons: lucide-react (already in use — see `WizardBar.tsx`)
- Section headings: `text-xs font-semibold uppercase tracking-wide text-muted-foreground`

## Insights index card grid

```
┌──────────────────────────────────────────────────────────┐
│ Market Intelligence                                       │
│ ─────────────────────────────────────────────────────────│
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│ │ Position     │  │ Price        │  │ News         │     │
│ │ Reports      │  │ Intelligence │  │              │     │
│ │ ABC monthly  │  │ Daily price  │  │ Industry     │     │
│ │ → 24 mo data │  │ observations │  │ headlines    │     │
│ │              │  │ (Phase 1.8)  │  │ (Phase 1.8b) │     │
│ └──────────────┘  └──────────────┘  └──────────────┘     │
└──────────────────────────────────────────────────────────┘
```

Cards link to live page when ready, show "Coming soon" badge otherwise.

## Files

- `src/components/layouts/SubscriberShell.tsx` (NEW)
- `src/components/layouts/SubscriberSidebar.tsx` (NEW)
- `src/components/layouts/SubscriberSidebar.mobile.tsx` (NEW — drawer variant) OR same component with responsive logic
- `src/pages/insights/InsightsIndex.tsx` (NEW)
- `src/App.tsx` (extend — nested route)
- `src/lib/nav-config.ts` (NEW — central nav definition so future pages add by config)

## Success criteria

- `/insights` renders the index page with 3 cards (Position Reports active; Price Intelligence + News disabled)
- `/insights/position-reports` renders inside the SubscriberShell layout (sidebar visible)
- `/dashboard` also wrapped in SubscriberShell
- Sidebar Sign Out button calls Supabase Auth signOut and redirects to `/welcome`
- Mobile: sidebar drawer toggles on hamburger button; closes on route change
- Lighthouse accessibility ≥95
- Keyboard navigation: tab through sidebar items, Enter activates
- Designer agent post-audit: passes (verdict ≥ 0.7)

## Risks + mitigations

- **Risk:** Existing `/dashboard` already has its own header/layout. **Mitigation:** Inspect `src/pages/Dashboard.tsx` first; if it has its own header, refactor it to use `SubscriberShell`'s header (single source of truth) — do NOT leave duplicate headers.
- **Risk:** Sign Out flow breaks on Supabase v2 type. **Mitigation:** Use `useAuth().signOut` from existing `AuthContext` (shipped in 1.3a).
- **Risk:** Sidebar shifts content on toggle. **Mitigation:** sidebar is `position: fixed` on mobile; desktop uses CSS grid with fixed-width column.

## NEVER list

- No replacing the Atlas dashboard layout (Atlas has its own bespoke shell at `/atlas`)
- No introducing a separate routing library — stick with React Router
- No hard-coded user info — pull `user.email` from `useAuth()`
