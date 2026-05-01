// Phase 1.10z — Dr. Atlas floating assistant button (FAB).
//
// Sits bottom-right on every authenticated page, hidden when not signed in.
// Clicking opens DrAtlasModal which streams replies from the dr-atlas edge
// function and logs every interaction through the drAtlas SDK.

import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { drAtlas } from '@/lib/drAtlas'
import { DrAtlasModal } from './DrAtlasModal'
import { Z } from '@/lib/z-indexes'

export function DrAtlasAssistant() {
  const { user } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  // Close the modal automatically on navigation so the chat doesn't bleed
  // across routes.
  useEffect(() => {
    if (open) setOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  if (!user) return null

  const handleOpen = () => {
    setOpen(true)
    drAtlas.log('dr_atlas_open', 'atlas', location.pathname, {
      source: 'dr_atlas',
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Open Dr. Atlas helper"
        className="
          fixed bottom-4 right-4
          size-12 rounded-full
          bg-primary text-primary-foreground
          shadow-lg ring-1 ring-black/5
          flex items-center justify-center
          transition-transform hover:scale-105 active:scale-95
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        "
        style={{ zIndex: Z.fab }}
      >
        <Sparkles className="size-5" aria-hidden="true" />
      </button>
      <DrAtlasModal
        open={open}
        onClose={() => setOpen(false)}
        pagePath={location.pathname}
      />
    </>
  )
}
