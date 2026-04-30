# Task: Phase 1.5a — Landing page (real, replacing the Welcome stub)

**Master plan reference:** §11.2 Phase 1.5 — "Public landing + market-insight pages"
**Context:** First impression for ALL CropsIntel visitors. Communicates: what CropsIntel is (almond market intelligence + CRM), who it's for (importers, growers, brokers, traders), why now (real-time data + AI prescriptions). Replaces the placeholder Welcome.tsx from 1.3h.
**Estimated effort:** ~45 min Builder time
**Model:** claude-sonnet-4-6

model: claude-sonnet-4-6

---

## Goal

A polished single-page landing experience with:
1. Hero section — headline, subhead, primary CTA, hero visual
2. Value prop trio (3 cards explaining what CropsIntel does)
3. Live data ribbon — recent prices/insights pulled from Supabase
4. CTA section — "Start free" + "Sign in"
5. Footer with links

## Files to create

```
src/pages/Landing.tsx                  # replaces Welcome.tsx
src/components/landing/Hero.tsx
src/components/landing/ValueProps.tsx
src/components/landing/LiveDataRibbon.tsx
src/components/landing/CtaSection.tsx
src/components/landing/Footer.tsx
src/components/landing/Header.tsx       # logo + nav links + sign-in CTA
```

## Wire into App.tsx

Replace the `Welcome` import with `Landing`:

```tsx
const Landing = lazy(() => import('./pages/Landing'))
// Route:
<Route path="/" element={<Landing />} />
```

## Header

```tsx
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'

export function Header() {
  const { user, tier } = useAuth()
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-white/80 dark:bg-slate-950/80 border-b border-slate-200/50 dark:border-slate-800/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold tracking-tight text-emerald-700 dark:text-emerald-500">
          CropsIntel
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-slate-700 dark:text-slate-300">
          <Link to="/insights" className="hover:text-emerald-700 transition-colors">Market</Link>
          <Link to="/news" className="hover:text-emerald-700 transition-colors">News</Link>
          <Link to="/about" className="hover:text-emerald-700 transition-colors">About</Link>
          <Link to="/pricing" className="hover:text-emerald-700 transition-colors">Pricing</Link>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild size="sm"><Link to="/dashboard">Dashboard</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm"><Link to="/signup">Get started</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
```

## Hero

```tsx
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950" aria-hidden />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <div className="max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/30 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live almond market data
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Almond market intelligence,<br />
            <span className="bg-gradient-to-r from-emerald-700 to-emerald-500 bg-clip-text text-transparent">
              built for global trading houses
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            Track shipments, monitor prices, manage relationships, and get AI-driven prescriptions —
            all in one CRM-grade workspace, made for importers, brokers, and growers across the global almond chain.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild size="lg">
              <Link to="/signup">Start free</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/insights">Browse market</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
```

## Value Props (3 cards)

```tsx
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
```

## LiveDataRibbon

Pulls last 5 rows from `position_reports` or `market_data` table. If empty (Phase 1.6 hasn't shipped Adela yet), show static seed data with disclaimer.

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface DataPoint {
  label: string
  value: string
  change?: string
}

export function LiveDataRibbon() {
  const [data, setData] = useState<DataPoint[]>([])

  useEffect(() => {
    async function load() {
      // Try real data first
      const { data: rows } = await supabase
        .from('canonical_products')
        .select('display_name, latest_price_usd_per_lb')
        .limit(5)

      if (rows && rows.length > 0) {
        setData(rows.map(r => ({
          label: r.display_name,
          value: r.latest_price_usd_per_lb ? `$${r.latest_price_usd_per_lb}/lb` : '—',
        })))
      } else {
        // Static fallback until Adela ships in Phase 1.6
        setData([
          { label: 'Nonpareil 23/25', value: '$2.95/lb', change: '+1.7%' },
          { label: 'Carmel SS 25/27', value: '$2.50/lb', change: '−0.3%' },
          { label: 'Independence 27/30', value: '$2.30/lb', change: '+0.8%' },
        ])
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
```

## CtaSection

```tsx
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'

export function CtaSection() {
  return (
    <section className="py-24 bg-gradient-to-br from-emerald-600 to-emerald-700">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center space-y-6">
        <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
          The almond market, decoded.
        </h2>
        <p className="text-emerald-50 text-lg max-w-2xl mx-auto">
          Join growers, brokers, and importers using CropsIntel to read the market and run smarter trades.
        </p>
        <div className="flex flex-wrap gap-3 justify-center pt-2">
          <Button asChild size="lg" variant="secondary">
            <Link to="/signup">Get started — it's free</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="bg-transparent border-white text-white hover:bg-white/10">
            <Link to="/about">Learn more</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
```

## Footer

Standard footer with logo, copyright, and 3 link columns: Product (Insights, News, Pricing), Company (About, Contact), Legal (Privacy, Terms — placeholder routes).

## src/pages/Landing.tsx

```tsx
import { Header } from '@/components/landing/Header'
import { Hero } from '@/components/landing/Hero'
import { LiveDataRibbon } from '@/components/landing/LiveDataRibbon'
import { ValueProps } from '@/components/landing/ValueProps'
import { CtaSection } from '@/components/landing/CtaSection'
import { Footer } from '@/components/landing/Footer'
import { useEffect } from 'react'

export default function Landing() {
  useEffect(() => { document.title = 'CropsIntel — Almond market intelligence' }, [])
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <LiveDataRibbon />
        <ValueProps />
        <CtaSection />
      </main>
      <Footer />
    </div>
  )
}
```

## Acceptance criteria

After this task ships:

1. `/` renders the new Landing page (replacing Welcome stub)
2. Header sticky, blurred backdrop, links to all sections
3. Hero with gradient background, badge, headline, subhead, two CTAs
4. LiveDataRibbon pulls from canonical_products OR shows fallback
5. 3 value-prop cards with emerald icon backgrounds
6. CTA section with emerald gradient + white CTAs
7. Footer with logo + 3 link columns
8. Mobile responsive (375px → 1280px+)
9. Page title set via useEffect
10. `npm run build` succeeds

## Designer audit (strict)

- ALL colors via Tailwind tokens (emerald-*, slate-*) — NO hex
- ALL clickable: Button or Link — NO raw <div onClick>
- ALL h1/h2 unique on page (one h1)
- Focus rings visible on every interactive
- Section spacing: py-20 minimum, py-24 for hero/cta
- Card hover: hover:shadow-md transition
- Mobile padding: px-4 sm:px-6
- Max content width: max-w-7xl

## Out of scope

- Animated illustrations (defer)
- Video hero (defer)
- Newsletter signup form (Phase 2)
- Social proof / logo wall (Phase 2)
- Internationalization (Phase 1.12)

## Notes

- This is the FIRST page non-customers see — quality matters
- Designer agent (1.10n) will audit this one strictly — make sure ALL anti-patterns avoided
- Live data ribbon gracefully degrades to static if DB empty — important until Phase 1.6 ships Adela
- Header sticky positioning must use z-40 to appear above page content
