import { FileText, FileVideo, FileImage, File as FileIcon, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PendingAttachment {
  // Local-only id (uuid) used while uploading.
  localId: string
  file: File
  status: 'uploading' | 'ready' | 'error'
  error?: string
  // Populated when status === 'ready'
  remote?: AttachmentRecord
  previewUrl?: string
}

export interface AttachmentRecord {
  id: string
  name: string
  size: number
  mime: string
  storage_path: string
  signed_url: string
  signed_url_expires_at: string
}

interface AttachmentPreviewProps {
  attachments: PendingAttachment[]
  onRemove: (localId: string) => void
  className?: string
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function iconFor(mime: string) {
  const lc = mime.toLowerCase()
  if (lc.startsWith('image/')) return FileImage
  if (lc.startsWith('video/')) return FileVideo
  if (lc === 'application/pdf' || lc.startsWith('text/')) return FileText
  return FileIcon
}

export function AttachmentPreview({ attachments, onRemove, className }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null

  return (
    <div className={cn('flex flex-wrap gap-2 px-1 pb-2', className)}>
      {attachments.map((att) => {
        const Icon = iconFor(att.file.type)
        const isImage = att.file.type.startsWith('image/')
        const isVideo = att.file.type.startsWith('video/')
        return (
          <div
            key={att.localId}
            className={cn(
              'group relative flex items-center gap-2 rounded-md border bg-card pr-1 max-w-[18rem]',
              att.status === 'error' ? 'border-red-300 dark:border-red-800' : 'border-slate-200 dark:border-slate-700',
            )}
          >
            {isImage && att.previewUrl ? (
              <img
                src={att.previewUrl}
                alt={att.file.name}
                className="h-12 w-12 rounded-l-md object-cover"
              />
            ) : isVideo && att.previewUrl ? (
              <video
                src={att.previewUrl}
                className="h-12 w-12 rounded-l-md object-cover bg-black"
                muted
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-l-md bg-slate-100 dark:bg-slate-800">
                <Icon className="size-5 text-slate-500" />
              </div>
            )}

            <div className="flex flex-col min-w-0 py-1 pr-2">
              <span className="truncate text-xs font-medium text-foreground" title={att.file.name}>
                {att.file.name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {att.status === 'uploading' && (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    Uploading…
                  </span>
                )}
                {att.status === 'ready' && formatBytes(att.file.size)}
                {att.status === 'error' && (
                  <span className="text-red-600 dark:text-red-400">{att.error ?? 'Upload failed'}</span>
                )}
              </span>
            </div>

            <button
              type="button"
              aria-label={`Remove ${att.file.name}`}
              onClick={() => onRemove(att.localId)}
              className="ml-auto rounded-full p-1 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
