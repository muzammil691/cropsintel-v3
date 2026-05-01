# Task: Phase 1.4c — Admin route protection + admin layout

**Master plan reference:** §11.2 Phase 1.4 — admin-tier (maxons) features need their own route prefix and layout
**Context:** All admin features (offer management, verified-tier review queue, atlas oversight) live under `/admin/*`. This task creates the layout shell, sidebar navigation, and route protection.
**Estimated effort:** ~25 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

Provide a clean admin shell with sidebar navigation. All `/admin/*` routes require `tier='maxons'`. Layout reflects gravity of admin actions — clean, structured, no marketing fluff.

## Files to create

```
src/pages/admin/AdminLayout.tsx           # shell with sidebar + main content area
src/pages/admin/AdminDashboard.tsx        # / admin landing
src/components/admin/AdminSidebar.tsx
src/components/admin/AdminTopbar.tsx
```

## src/pages/admin/AdminLayout.tsx

```tsx
import { Outlet } from 'react-router-dom'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { AdminTopbar } from '@/components/admin/AdminTopbar'

export default function AdminLayout() {
  return (
    <AuthGuard requiredTier="maxons">
      <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
        <AdminSidebar />
        <div className="flex-1 flex flex-col">
          <AdminTopbar />
          <main className="flex-1 p-8 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}
```

## src/components/admin/AdminSidebar.tsx

```tsx
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, FileText, Briefcase, AlertCircle, Cog } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/admin', icon: LayoutDashboard, label: 'Overview', exact: true },
  { to: '/admin/users', icon: Users, label: 'Users & Tiers' },
  { to: '/admin/verifications', icon: AlertCircle, label: 'Verification queue' },
  { to: '/admin/companies', icon: Briefcase, label: 'Companies' },
  { to: '/admin/offers', icon: FileText, label: 'Offers' },
  { to: '/admin/settings', icon: Cog, label: 'Settings' },
]

export function AdminSidebar() {
  return (
    <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
      <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-lg font-bold text-emerald-700 dark:text-emerald-500">CropsIntel</h1>
        <p className="text-xs text-slate-500 mt-0.5">Admin</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
```

## src/components/admin/AdminTopbar.tsx

```tsx
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { Link } from 'react-router-dom'

export function AdminTopbar() {
  const { user, signOut } = useAuth()
  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          ← Back to public site
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-700 dark:text-slate-300">{user?.display_name}</span>
        <Button variant="ghost" size="sm" onClick={() => signOut()} className="gap-2">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </header>
  )
}
```

## src/pages/admin/AdminDashboard.tsx

Landing page for admin. Show high-level KPIs:
- Pending verifications count
- New users last 7 days
- Active offers
- Atlas snapshot embed (link to /atlas)

Use shadcn/ui Card grid. 4 stat cards in 2x2 on tablet, 1x4 on desktop.

## Wire into App.tsx

```tsx
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const NotImplemented = lazy(() => import('./components/NotImplemented'))

// Routes:
<Route path="/admin" element={<AdminLayout />}>
  <Route index element={<AdminDashboard />} />
  <Route path="users" element={<NotImplemented label="Phase 2 — User management" />} />
  <Route path="verifications" element={<NotImplemented label="Phase 1.11b — Verification queue" />} />
  <Route path="companies" element={<NotImplemented label="Phase 2 — Company management" />} />
  <Route path="offers" element={<NotImplemented label="Phase 2.3 — Offer management" />} />
  <Route path="settings" element={<NotImplemented label="Phase 2 — Admin settings" />} />
</Route>
```

## Acceptance criteria

After this task ships:

1. `/admin` redirects non-maxons users to `/upgrade`
2. `/admin` shows AdminLayout with sidebar + topbar
3. AdminDashboard renders with stat cards (placeholders OK for queries)
4. Sidebar navigation works — clicking items routes correctly with active highlight
5. "Back to public site" link works
6. Sign out button works
7. Mobile: at < 768px, sidebar collapses to top hamburger or hides (defer fancy mobile nav to Phase 2)
8. `npm run build` succeeds

## Design system requirements (Designer audit)

- Sidebar: white bg, slate border, emerald accents
- Active nav item: emerald-50 bg + emerald-700 text + font-medium
- Topbar: 56px height, white bg, slate bottom border
- Main content: slate-50 bg, p-8
- Card grid: gap-4, lg:grid-cols-4 md:grid-cols-2 grid-cols-1
- Icons: lucide-react, h-4 w-4, text matches parent

## Out of scope

- User management table (Phase 2)
- Bulk verification actions (Phase 2)
- Audit log viewer (Phase 3)
- Mobile-optimized admin (Phase 2 — admin assumed desktop-first)

## Notes

- Single-tenant admin = all maxons users see all data
- AdminLayout uses Outlet for nested routes (React Router v6 pattern)
- All future admin pages (`/admin/users`, `/admin/companies`, etc.) plug into this layout
- sidebar collapse for mobile is a v2 polish — for now hide below md
