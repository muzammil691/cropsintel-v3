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
