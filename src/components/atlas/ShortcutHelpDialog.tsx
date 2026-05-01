import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ShortcutHelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Shortcut {
  keys: string[]
  description: string
}

const SHORTCUTS: Array<{ section: string; items: Shortcut[] }> = [
  {
    section: 'Send & edit',
    items: [
      { keys: ['Cmd', 'Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'Newline in input' },
      { keys: ['Cmd', 'Shift', 'V'], description: 'Paste as plain text (strip formatting)' },
      { keys: ['Cmd', 'Shift', 'C'], description: 'Copy last Atlas response as markdown' },
      { keys: ['Esc'], description: 'Cancel ongoing tool call / streaming response' },
    ],
  },
  {
    section: 'Navigate',
    items: [
      { keys: ['Cmd', 'K'], description: 'Search across chat history' },
      { keys: ['Cmd', '/'], description: 'Open this shortcut help' },
      { keys: ['Cmd', ';'], description: 'Toggle voice (live) mode' },
    ],
  },
]

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono shadow-sm">
      {children}
    </kbd>
  )
}

export function ShortcutHelpDialog({ open, onOpenChange }: ShortcutHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Atlas chat keyboard shortcuts. Use Cmd on macOS, Ctrl on Windows / Linux.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {SHORTCUTS.map((group) => (
            <div key={group.section}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                {group.section}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.description} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{item.description}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={`${item.description}-${k}-${i}`} className="flex items-center gap-1">
                          <Key>{k}</Key>
                          {i < item.keys.length - 1 && <span className="text-slate-400 text-xs">+</span>}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
