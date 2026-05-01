import { useEffect } from 'react'
import { Header } from '@/components/landing/Header'
import { Hero } from '@/components/landing/Hero'
import { LiveDataRibbon } from '@/components/landing/LiveDataRibbon'
import { ValueProps } from '@/components/landing/ValueProps'
import { CtaSection } from '@/components/landing/CtaSection'
import { Footer } from '@/components/landing/Footer'

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
