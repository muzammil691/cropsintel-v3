import { useState } from 'react'
import { GitFork, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type { Fork } from '@/lib/atlas-client'

interface ForkListProps {
  forks: Fork[]
  onDecide?: (fork: Fork, option: string) => void
}

export function ForkList({ forks, onDecide }: ForkListProps) {
  const [selected, setSelected] = useState<Fork | null>(null)

  if (forks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">No open forks — Atlas is aligned.</p>
    )
  }

  return (
    <>
      <ul className="space-y-1.5">
        {forks.map((fork) => (
          <li key={fork.id}>
            <button
              onClick={() => setSelected(fork)}
              className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 transition-colors group"
            >
              <GitFork className="size-3.5 mt-0.5 text-amber-500 shrink-0" />
              <span className="flex-1 line-clamp-2">{fork.title}</span>
              <ChevronRight className="size-3.5 mt-0.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        {selected && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GitFork className="size-4 text-amber-500" />
                {selected.title}
              </DialogTitle>
              <DialogDescription>{selected.description}</DialogDescription>
            </DialogHeader>

            {selected.options && selected.options.length > 0 && (
              <div className="space-y-2 py-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Options</p>
                {selected.options.map((opt, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="w-full justify-start text-left h-auto py-2 px-3"
                    onClick={() => {
                      onDecide?.(selected, opt)
                      setSelected(null)
                    }}
                  >
                    {opt}
                  </Button>
                ))}
              </div>
            )}

            <DialogFooter showCloseButton />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
