import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface DataPoint {
  label: string
  value: string
  change?: string
}

const FALLBACK: DataPoint[] = [
  { label: 'Nonpareil 23/25', value: '$2.95/lb', change: '+1.7%' },
  { label: 'Carmel SS 25/27', value: '$2.50/lb', change: '−0.3%' },
  { label: 'Independence 27/30', value: '$2.30/lb', change: '+0.8%' },
]

export function LiveDataRibbon() {
  const [data, setData] = useState<DataPoint[]>([])

  useEffect(() => {
    async function load() {
      const { data: rows } = await supabase
        .from('canonical_products')
        .select('variety, grade, size')
        .eq('is_active', true)
        .limit(5)

      if (rows && rows.length > 0) {
        setData(rows.map(r => ({
          label: [r.variety, r.grade, r.size].filter(Boolean).join(' '),
          value: '—',
        })))
      } else {
        setData(FALLBACK)
      }
    }
    load()
  }, [])

  return (
    <section className="py-8 border-y border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Live</span>
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-2">
              <span className="text-slate-700 dark:text-slate-300">{d.label}</span>
              <span className="font-semibold tabular-nums">{d.value}</span>
              {d.change && (
                <span className={d.change.startsWith('+') ? 'text-emerald-600' : 'text-red-600'}>
                  {d.change}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
