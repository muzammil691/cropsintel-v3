import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'
import { Link } from 'react-router-dom'

export function AdminTopbar() {
  const { profile, signOut } = useAuth()
  return (
    <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          ← Back to public site
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-700 dark:text-slate-300">{profile?.display_name}</span>
        <Button variant="ghost" size="sm" onClick={() => signOut()} className="gap-2">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </header>
  )
}
