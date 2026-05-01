import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'

export function Header() {
  const { user } = useAuth()
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
