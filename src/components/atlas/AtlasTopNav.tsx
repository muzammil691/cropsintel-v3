// Phase 1.10ae — Shared horizontal nav for every Atlas surface.
//
// Renders ATLAS_SURFACES (filtered by RBAC) as horizontal links on >=md
// and as a dropdown selector on <md. Active surface is highlighted via
// useLocation. Mounts above each Atlas page's existing header so the user
// can hop between /atlas, /atlas-brain, /atlas-pd without losing context.

import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { ATLAS_SURFACES, isSurfaceVisible } from '@/lib/atlas-nav'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

export function AtlasTopNav() {
  const { isAdmin, isTeam } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  const surfaces = ATLAS_SURFACES.filter((s) => isSurfaceVisible(s, { isAdmin, isTeam }))
  if (surfaces.length === 0) return null

  const active =
    surfaces.find((s) => s.path === pathname) ??
    surfaces.find((s) => pathname.startsWith(s.path + '/')) ??
    surfaces[0]

  return (
    <div
      role="navigation"
      aria-label="Atlas surfaces"
      className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/70"
    >
      {/* Desktop: horizontal pill bar */}
      <div className="hidden md:flex items-center gap-1 px-4 md:px-6 py-1.5 max-w-screen-2xl mx-auto">
        {surfaces.map((s) => {
          const Icon = s.icon
          const isActive = s.path === active.path
          return (
            <Link
              key={s.path}
              to={s.path}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 transition-colors duration-200 hover:bg-slate-200 dark:hover:bg-slate-800',
              )}
              title={s.description}
            >
              <Icon className="size-3.5" aria-hidden />
              <span>{s.label}</span>
            </Link>
          )
        })}
      </div>

      {/* Mobile: dropdown */}
      <div className="md:hidden relative px-3 py-1.5">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpen((o) => !o)
            }
          }}
          className="w-full flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50"
        >
          <span className="inline-flex items-center gap-1.5">
            <active.icon className="size-3.5 text-emerald-600" aria-hidden />
            <span>{active.label}</span>
            <span className="text-slate-400 hidden sm:inline">— {active.description}</span>
          </span>
          <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute left-3 right-3 mt-1 z-40 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden"
          >
            {surfaces.map((s) => {
              const Icon = s.icon
              const isActive = s.path === active.path
              return (
                <Link
                  key={s.path}
                  to={s.path}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
                    isActive
                      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'text-slate-700 dark:text-slate-300 transition-colors duration-200 hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  <span className="font-medium">{s.label}</span>
                  <span className="text-slate-400 ml-auto">{s.description}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
