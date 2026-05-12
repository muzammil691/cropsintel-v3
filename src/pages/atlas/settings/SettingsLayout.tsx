// 1.10bb-c Session 9A — Settings shell.
//
// Sidebar nav with Outlet for the five sub-pages. Sits inside the existing
// AtlasAuthGuard wrapper (App.tsx). The sidebar mirrors AtlasTabBar's visual
// style — same border colors, same uppercase tracking, just vertical.

import { NavLink, Outlet } from 'react-router-dom'
import { ArrowLeft, User2, Plug, Bell, ScrollText, AlertOctagon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: typeof User2
}

const NAV: NavItem[] = [
  { to: '/atlas/settings/account',       label: 'Account',       icon: User2 },
  { to: '/atlas/settings/connections',   label: 'Connections',   icon: Plug },
  { to: '/atlas/settings/notifications', label: 'Notifications', icon: Bell },
  { to: '/atlas/settings/audit',         label: 'Audit',         icon: ScrollText },
  { to: '/atlas/settings/danger',        label: 'Danger Zone',   icon: AlertOctagon },
]

export function SettingsLayout() {
  return (
    <section className="flex flex-col md:flex-row h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
      <aside
        className="md:w-56 lg:w-64 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col"
        aria-label="Settings navigation"
      >
        <header className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <NavLink
            to="/atlas"
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors duration-200"
          >
            <ArrowLeft className="size-3" aria-hidden /> Cockpit
          </NavLink>
          <h2 className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
            Settings
          </h2>
        </header>
        <nav className="p-1 flex flex-row md:flex-col gap-0.5 overflow-x-auto md:overflow-x-visible">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn(
                  'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
                  isActive
                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 font-medium'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {item.label}
              </NavLink>
            )
          })}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </section>
  )
}

export default SettingsLayout
