// Shared admin/team nav items. Single source of truth for the admin sidebar
// and any other nav surfaces that link into the cockpit pages.

import type { ComponentType } from 'react'
import {
  LayoutDashboard,
  Users,
  FileText,
  Briefcase,
  AlertCircle,
  Cog,
  Brain,
  ClipboardList,
  Compass,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Match exact path (e.g. for index routes). */
  exact?: boolean
  /** Required role tier; nav surfaces filter by current user role. */
  tier?: 'admin' | 'team' | 'maxons_team'
}

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true, tier: 'maxons_team' },
  { to: '/admin/users', label: 'Users & Tiers', icon: Users, tier: 'maxons_team' },
  { to: '/admin/verifications', label: 'Verification queue', icon: AlertCircle, tier: 'maxons_team' },
  { to: '/admin/companies', label: 'Companies', icon: Briefcase, tier: 'maxons_team' },
  { to: '/admin/offers', label: 'Offers', icon: FileText, tier: 'maxons_team' },
  { to: '/admin/settings', label: 'Settings', icon: Cog, tier: 'maxons_team' },
]

// Cockpit pages live outside /admin — listed separately so the admin sidebar
// can render them as a second group.
export const COCKPIT_NAV_ITEMS: NavItem[] = [
  { to: '/atlas', label: 'Atlas', icon: Compass, tier: 'admin' },
  { to: '/atlas-brain', label: 'Atlas Brain', icon: Brain, tier: 'admin' },
  { to: '/atlas-pd', label: 'Atlas PD', icon: ClipboardList, tier: 'admin' },
]
