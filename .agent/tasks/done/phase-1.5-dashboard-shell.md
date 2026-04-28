# Task: Phase 1.5 — Dashboard Shell + Navigation

**Master plan reference:** section 11.5
**Depends on:** Phase 1.4 (org setup must work)
**Estimated effort:** ~4-6 hours; iterate.

---

## Goal

Build the main app shell — sidebar nav, top bar, content area — that all subsequent feature pages render into. Plus a simple `/dashboard` landing with KPI cards that the agent can flesh out in Phase 1.10.

## In scope

### Layout
- `src/components/layout/AppShell.tsx` — wraps every authenticated route with sidebar + topbar
- `src/components/layout/Sidebar.tsx` — collapsible, icon-based, links to: Dashboard / Markets / CRM / Trading / Reports / Settings
- `src/components/layout/Topbar.tsx` — left: org name + commodity selector dropdown; right: notifications bell, user avatar menu
- `src/components/layout/CommoditySelector.tsx` — dropdown listing all rows in `commodities` table; persists choice to `localStorage` and updates a global Zustand store

### Pages
- `src/pages/Dashboard.tsx` — replace stub. Layout: 4 KPI cards on top (Total contacts, Active offers, Open trades, Market price ▲%), then 2 columns: "Recent activity" feed (empty state ok), "Upcoming follow-ups" (empty state ok)
- `src/pages/Markets.tsx` — placeholder, "Markets data coming in Phase 1.10"
- `src/pages/Trading.tsx` — placeholder
- `src/pages/Reports.tsx` — placeholder
- `src/pages/Settings.tsx` — basic settings page with tabs: Profile, Org, Members, Notifications

### State
- Add Zustand: `npm install zustand`
- `src/stores/commodityStore.ts` — current commodity, available commodities, switchCommodity()

### Routing
- Every authenticated route uses `<AppShell>` wrapper
- Routes: `/dashboard`, `/markets`, `/crm`, `/trading`, `/reports`, `/settings`, `/admin/*`
- Settings has nested routes: `/settings/profile`, `/settings/org`, `/settings/members`, `/settings/notifications`

### Library
- `src/hooks/useCommodity.ts` — hook returning current commodity from Zustand
- `src/lib/dashboard.ts` — aggregateKPIs(orgId, commodityId) — runs counts; can return zeros for now

## Out of scope
- Real KPI data (just hard-code zeros for now; Phase 1.10 wires up data)
- Charts on dashboard (Phase 2)
- Notifications panel (Phase 1.12)

## Acceptance criteria

1. Logged-in user lands on `/dashboard` with the layout rendered
2. Sidebar links navigate between placeholder pages
3. Commodity selector in topbar shows commodities from DB; changing it updates Zustand and persists across page reloads
4. Topbar shows current org name (from `profiles.current_org_id` → org name lookup)
5. Avatar menu has: Profile / Settings / Sign out
6. Mobile responsive: sidebar collapses to hamburger menu below 768px
7. `npm run build` passes

## Notes
- Use shadcn components: `sidebar` (`npx shadcn@latest add sidebar`), `dropdown-menu`, `avatar`, `card`, `tabs`
- Lucide icons for nav items (LayoutDashboard, TrendingUp, Users, Briefcase, FileBarChart, Settings)
- Keep it functional, not pretty — Phase 3 polishes UI

---

**Done condition:** signed-in user sees a real app shell with working nav, build green.
