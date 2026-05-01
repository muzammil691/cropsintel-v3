import { TrendingUp, MessageSquare, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'

const PROPS = [
  {
    icon: TrendingUp,
    title: 'Live market intelligence',
    body: 'Daily-refreshed almond prices, ABC objective reports, position data, and shipment trends. Never trade on stale numbers.',
  },
  {
    icon: MessageSquare,
    title: 'Zyra — your AI co-worker',
    body: 'Ask anything about the market, your customers, your inventory. Zyra answers with full context — and remembers.',
  },
  {
    icon: Users,
    title: 'Three relationship graphs',
    body: 'CRM (customers), BRM (brokers), SRM (suppliers) — separately scoped, role-aware, with AI-suggested next moves.',
  },
]

export function ValueProps() {
  return (
    <section className="py-20 bg-slate-50 dark:bg-slate-900/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid md:grid-cols-3 gap-6">
          {PROPS.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="p-6 space-y-3 hover:shadow-md transition-shadow border-slate-200/50 dark:border-slate-800">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 w-10 h-10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
              </div>
              <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{body}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
