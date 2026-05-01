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
