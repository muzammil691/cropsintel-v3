import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createAtlasProject, type AtlasProject } from '@/lib/atlas-client'

interface NewProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: AtlasProject) => void
}

/**
 * Phase 1.10av — owner-only dialog to create a new Atlas project.
 *
 * Stub form: slug + display_name (required), description + repo_url (optional).
 * On success, the parent ProjectSwitcher auto-switches to the new project so
 * the cockpit reloads against an empty plan/queue/audit set.
 */
export function NewProjectDialog({ open, onOpenChange, onCreated }: NewProjectDialogProps) {
  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setSlug('')
    setDisplayName('')
    setDescription('')
    setRepoUrl('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!slug.trim() || !displayName.trim()) {
      setError('Slug and display name are required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await createAtlasProject({
        slug: slug.trim().toLowerCase(),
        display_name: displayName.trim(),
        description: description.trim() || undefined,
        repo_url: repoUrl.trim() || undefined,
      })
      onCreated(result.project)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!submitting) {
          if (!v) reset()
          onOpenChange(v)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Atlas project</DialogTitle>
          <DialogDescription>
            Each project gets its own plan, queue, agents, and chat context. You'll be the owner.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="np-slug">Slug</Label>
            <Input
              id="np-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. project-2"
              autoComplete="off"
              required
              pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
              title="Lowercase letters, digits, and hyphens. Must start and end with a letter or digit."
              disabled={submitting}
            />
            <p className="text-[11px] text-slate-500">URL-safe identifier. Lowercase, hyphens.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="np-display-name">Display name</Label>
            <Input
              id="np-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Project Two"
              required
              disabled={submitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="np-description">Description (optional)</Label>
            <Textarea
              id="np-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={2}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="np-repo-url">Repo URL (optional)</Label>
            <Input
              id="np-repo-url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="git@github.com:owner/repo.git"
              autoComplete="off"
              disabled={submitting}
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
