import { useRef, useState } from 'react'
import { Upload, Wand2, CheckSquare, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface PlanToolbarProps {
  onUpload: (markdown: string) => Promise<void> | void
  onAmend: (instruction: string) => Promise<void> | void
  multiSelect: boolean
  onToggleMultiSelect: () => void
  onRefresh: () => void
  busy: boolean
  selectionCount: number
  onBuildSelected?: () => void
  onDiscussSelected?: () => void
  onMoveSelectedToQueue?: () => void
}

export function PlanToolbar({
  onUpload,
  onAmend,
  multiSelect,
  onToggleMultiSelect,
  onRefresh,
  busy,
  selectionCount,
  onBuildSelected,
  onDiscussSelected,
  onMoveSelectedToQueue,
}: PlanToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [instruction, setInstruction] = useState('')

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      if (text) void onUpload(text)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 px-4 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload className="size-3.5" />
          Upload plan
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={busy}
          title="Reload plan from main"
        >
          <RefreshCcw className="size-3.5" />
          Refresh
        </Button>
        <Button
          variant={multiSelect ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleMultiSelect}
          disabled={busy}
          aria-pressed={multiSelect}
        >
          <CheckSquare className="size-3.5" />
          {multiSelect ? `Selecting (${selectionCount})` : 'Multi-select'}
        </Button>
        {multiSelect && selectionCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            <Button size="sm" onClick={onBuildSelected} disabled={busy}>
              Build all selected
            </Button>
            <Button size="sm" variant="outline" onClick={onDiscussSelected} disabled={busy}>
              Discuss all
            </Button>
            <Button size="sm" variant="outline" onClick={onMoveSelectedToQueue} disabled={busy}>
              Move to Queue
            </Button>
          </div>
        )}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = instruction.trim()
          if (!trimmed) return
          void onAmend(trimmed)
          setInstruction('')
        }}
      >
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='Amend by command (e.g. "move 1.8 before 1.7", "rename phase 1.10 to Atlas perfection")'
          className="text-sm h-8"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !instruction.trim()}>
          <Wand2 className="size-3.5" />
          Amend
        </Button>
      </form>
    </div>
  )
}
