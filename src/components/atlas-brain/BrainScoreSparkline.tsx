// Phase 1.10ab — BrainScoreSparkline
//
// Tiny line chart of score over time, no axes, pure trend strip.

import { useMemo } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { BrainNodeHistoryRow } from '@/lib/brain-client'

export interface BrainScoreSparklineProps {
  history: BrainNodeHistoryRow[]
  currentScore: number
  height?: number
}

interface Point {
  x: number
  score: number
  date: string
}

export function BrainScoreSparkline({ history, currentScore, height = 56 }: BrainScoreSparklineProps) {
  const data = useMemo<Point[]>(() => {
    if (history.length === 0) {
      return [
        { x: 0, score: currentScore, date: 'now' },
        { x: 1, score: currentScore, date: 'now' },
      ]
    }
    const pts: Point[] = history.map((h, i) => ({
      x: i,
      score: h.score_after ?? h.score_before ?? 0,
      date: new Date(h.created_at).toLocaleDateString(),
    }))
    pts.push({ x: pts.length, score: currentScore, date: 'now' })
    return pts
  }, [history, currentScore])

  return (
    <div className="w-full" style={{ height }} aria-label="Score history sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Line
            type="monotone"
            dataKey="score"
            stroke="currentColor"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            className="text-emerald-600 dark:text-emerald-400"
          />
          <Tooltip
            cursor={{ stroke: 'rgba(100,116,139,0.3)' }}
            contentStyle={{
              fontSize: 11,
              padding: '4px 6px',
              background: 'rgba(15,23,42,0.92)',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
            }}
            formatter={(v) => [Math.round(Number(v ?? 0)), 'score']}
            labelFormatter={(_l, items) => {
              const item = items?.[0]?.payload as Point | undefined
              return item?.date ?? ''
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
