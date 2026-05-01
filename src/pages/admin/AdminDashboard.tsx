import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'
import { AlertCircle, Users, FileText, Activity } from 'lucide-react'

interface Stats {
  pendingVerifications: number
  newUsersLast7Days: number
  activeOffers: number
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({ pendingVerifications: 0, newUsersLast7Days: 0, activeOffers: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadStats() {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [verifications, newUsers] = await Promise.all([
        supabase
          .from('companies')
          .select('id', { count: 'exact', head: true })
          .eq('verification_status', 'pending_review'),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', sevenDaysAgo),
      ])

      setStats({
        pendingVerifications: verifications.count ?? 0,
        newUsersLast7Days: newUsers.count ?? 0,
        activeOffers: 0,
      })
      setLoading(false)
    }

    loadStats()
  }, [])

  const cards = [
    {
      title: 'Pending verifications',
      value: stats.pendingVerifications,
      icon: AlertCircle,
      href: '/admin/verifications',
      color: 'text-amber-600',
    },
    {
      title: 'New users (7 days)',
      value: stats.newUsersLast7Days,
      icon: Users,
      href: '/admin/users',
      color: 'text-blue-600',
    },
    {
      title: 'Active offers',
      value: stats.activeOffers,
      icon: FileText,
      href: '/admin/offers',
      color: 'text-emerald-600',
      note: 'Phase 2',
    },
    {
      title: 'Atlas',
      value: null,
      icon: Activity,
      href: '/atlas',
      color: 'text-violet-600',
      note: 'Open dashboard →',
    },
  ]

  return (
    <>
      <Helmet><title>Admin — CropsIntel</title></Helmet>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Overview</h2>
          <p className="text-sm text-slate-500 mt-1">System snapshot</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(({ title, value, icon: Icon, href, color, note }) => (
            <Link key={title} to={href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    {title}
                  </CardTitle>
                  <Icon className={`h-4 w-4 ${color}`} aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  {value !== null ? (
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                      {loading ? '—' : value}
                    </p>
                  ) : (
                    <p className={`text-sm font-medium ${color}`}>{note}</p>
                  )}
                  {note && value !== null && (
                    <p className="text-xs text-slate-400 mt-1">{note}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
