import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  children: ReactNode
  title: string
  subtitle?: string
  footerText?: string
  footerLink?: { to: string; label: string }
}

export function AuthLayout({ children, title, subtitle, footerText, footerLink }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <Link
        to="/"
        className="text-2xl font-bold text-emerald-700 dark:text-emerald-500 mb-6 hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 rounded-sm"
      >
        CropsIntel
      </Link>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl tracking-tight font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {children}
      </div>
      {footerText && footerLink && (
        <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">
          {footerText}{' '}
          <Link
            to={footerLink.to}
            className="text-emerald-700 dark:text-emerald-500 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 rounded-sm"
          >
            {footerLink.label}
          </Link>
        </p>
      )}
    </div>
  )
}
