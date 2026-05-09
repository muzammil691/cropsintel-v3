// Phase 1.3b — 4 hard-coded starter prompts shown above the input box.
//
// The hybrid-starter pattern (locked with Muzammil 2026-05-09): chips give
// new visitors a one-click way in; the free input below is for everyone else.
// Each chip's text becomes a real user message via `onSelect`.

import { Button } from '@/components/ui/button'

export interface StarterPrompt {
  label: string
  prompt: string
}

const STARTERS: StarterPrompt[] = [
  { label: "I'm buying for India", prompt: "I'm buying almonds for India — what should I be watching this week?" },
  { label: "I'm a US packer looking at exports", prompt: "I'm a US packer looking at export markets. Where's demand strongest right now?" },
  { label: "I'm a broker watching arbitrage", prompt: "I'm a broker watching almond arbitrage between origins. What spreads matter today?" },
  { label: "Just exploring", prompt: "I'm just exploring — what does CropsIntel actually do?" },
]

interface Props {
  onSelect: (prompt: string) => void
  disabled?: boolean
}

export function StarterChips({ onSelect, disabled = false }: Props) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="landing-starter-chips">
      {STARTERS.map((s) => (
        <Button
          key={s.label}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(s.prompt)}
          data-testid={`starter-chip-${slug(s.label)}`}
          className="rounded-full border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:ring-offset-2 transition-colors duration-200 text-xs sm:text-sm"
        >
          {s.label}
        </Button>
      ))}
    </div>
  )
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
