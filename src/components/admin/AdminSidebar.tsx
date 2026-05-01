import { NavLink } from 'react-router-dom'
import { ADMIN_NAV_ITEMS, COCKPIT_NAV_ITEMS } from '@/lib/nav-config'
import { cn } from '@/lib/utils'

const NAV_ITEMS = ADMIN_NAV_ITEMS.map((i) => ({ to: i.to, icon: i.icon, label: i.label, exact: i.exact }))
const COCKPIT = COCKPIT_NAV_ITEMS.map((i) => ({ to: i.to, icon: i.icon, label: i.label, exact: i.exact }))

export function AdminSidebar() {
  return (
    <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col hidden md:flex">
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
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200',
                isActive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium'
                  : 'text-slate-700 dark:text-slate-300 transition-colors duration-200 hover:bg-slate-100 dark:hover:bg-slate-800',
              )
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
        <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800">
          <p className="px-3 mb-2 text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Cockpit</p>
          {COCKPIT.map(({ to, icon: Icon, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200',
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium'
                    : 'text-slate-700 dark:text-slate-300 transition-colors duration-200 hover:bg-slate-100 dark:hover:bg-slate-800',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </aside>
  )
}
