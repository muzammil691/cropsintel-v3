// 1.10bb-c Session 9A — Notifications page (placeholder).
//
// 9B: WhatsApp dispatch number, alert routing toggle, quiet hours.

import { Bell } from 'lucide-react'

export function NotificationsPage() {
  return (
    <div className="px-3 sm:px-5 py-4 max-w-3xl mx-auto w-full space-y-4">
      <header>
        <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Bell className="size-4 text-emerald-600" aria-hidden /> Notifications
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          WhatsApp dispatch number, alert routing, and quiet hours land in Session 9B.
        </p>
      </header>
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-6 py-10 text-center">
        <Bell className="size-5 mx-auto text-slate-400 mb-2" aria-hidden />
        <p className="text-sm text-slate-700 dark:text-slate-200 font-medium">Coming in 9B</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Until then alerts route to the WhatsApp number on your Account page (default
          fallback = VERIFIER_ALERT_PHONE on Railway).
        </p>
      </div>
    </div>
  )
}

export default NotificationsPage
