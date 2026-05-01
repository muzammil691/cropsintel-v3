// Phase 1.10ae — Single source of truth for Atlas surface registry.
//
// All Atlas pages (/atlas, /atlas-brain, /atlas-pd, /atlas/events) declare
// themselves here. AtlasTopNav reads this list to render its links. Adding
// a new Atlas surface is a one-line addition here; no other change needed.

import { LayoutDashboard, Brain, FolderKanban, Activity } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

export type AtlasSurfaceTier = 'auth' | 'team' | 'admin'

export interface AtlasSurface {
  path: string
  label: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  requires: AtlasSurfaceTier
  shipped: boolean
}

export const ATLAS_SURFACES: AtlasSurface[] = [
  {
    path: '/atlas',
    label: 'Atlas',
    description: 'Conductor dashboard',
    icon: LayoutDashboard,
    requires: 'admin',
    shipped: true,
  },
  {
    path: '/atlas-brain',
    label: 'Brain',
    description: 'Multi-Brain debates',
    icon: Brain,
    requires: 'admin',
    shipped: true,
  },
  {
    path: '/atlas-pd',
    label: 'Project Dev',
    description: 'Proposals + decisions',
    icon: FolderKanban,
    requires: 'admin',
    shipped: true,
  },
  {
    path: '/atlas/events',
    label: 'Events',
    description: 'atlas_events live tail',
    icon: Activity,
    requires: 'admin',
    shipped: false,
  },
]

export function isSurfaceVisible(
  surface: AtlasSurface,
  ctx: { isAdmin: boolean; isTeam: boolean },
): boolean {
  if (!surface.shipped) return false
  if (surface.requires === 'admin') return ctx.isAdmin
  if (surface.requires === 'team') return ctx.isAdmin || ctx.isTeam
  return true
}
