import { Outlet } from 'react-router-dom'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { AdminTopbar } from '@/components/admin/AdminTopbar'

export default function AdminLayout() {
  return (
    <AuthGuard requiredTier="maxons_team">
      <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
        <AdminSidebar />
        <div className="flex-1 flex flex-col">
          <AdminTopbar />
          <main className="flex-1 p-8 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </AuthGuard>
  )
}
