// Atlas slash-command registry (1.10an-remediation-2)
//
// Co-located re-export of the canonical registry at `@/lib/atlas-slash-commands`
// so that downstream cockpit components can import from a path that matches
// the spec'd component tree (`src/components/atlas/lib/`). Keeping a single
// source of truth avoids the parallel-implementation hazard.

export {
  SLASH_COMMANDS,
  MENTION_AGENTS,
  parseSlashCommand,
  looksLikeSlashStart,
  filterCommands,
  commandSignature,
} from '@/lib/atlas-slash-commands'

export type {
  SlashCommand,
  SlashCommandKind,
  ParsedSlashCommand,
  MentionAgent,
} from '@/lib/atlas-slash-commands'
