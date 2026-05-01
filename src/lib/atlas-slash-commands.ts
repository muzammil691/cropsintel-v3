// Atlas slash-command registry + parser (1.10an)
//
// Used by SlashCommandMenu and the cockpit chat handler. The handler
// inspects `parseSlashCommand(input)` BEFORE forwarding to streamChat —
// destructive commands surface a confirm dialog, navigation commands
// switch tabs, the rest get rendered as both a tool card AND a synthesized
// chat reply once their result returns.

export type SlashCommandKind =
  | 'tool' // dispatches a backend tool call
  | 'navigate' // switches to a tab / route
  | 'destructive' // requires confirm before firing
  | 'help' // renders the registry inline

export interface SlashCommand {
  /** Word after the leading slash, lower-case, no slash. */
  name: string
  /** Optional arg hint shown after `/<name>` in the menu. */
  argHint?: string
  description: string
  kind: SlashCommandKind
  /**
   * Backend tool the chat handler should call. Optional for navigate/help.
   * The actual dispatch lives server-side; the cockpit just forwards intent.
   */
  tool?: string
  /**
   * For navigate commands, which cockpit tab to open.
   */
  targetTab?: 'plan' | 'queue' | 'agents' | 'audit' | 'workflows' | 'artifacts'
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'fix', argHint: '<error>', description: 'Diagnose + fix an error', kind: 'tool', tool: 'atlas.diagnose' },
  { name: 'spec', argHint: '<phase>', description: 'Queue a new spec', kind: 'tool', tool: 'builder.queue_spec' },
  { name: 'status', description: 'Status snapshot', kind: 'tool', tool: 'status.snapshot' },
  { name: 'queue', description: 'Show queued specs', kind: 'tool', tool: 'builder.list_queue' },
  { name: 'done', description: 'Show shipped specs (last 20)', kind: 'tool', tool: 'builder.list_done' },
  { name: 'agents', description: 'Show agent health', kind: 'tool', tool: 'status.snapshot' },
  { name: 'cost', description: 'Cost today + MTD', kind: 'tool', tool: 'status.snapshot' },
  { name: 'priority', argHint: '<task> <1-10>', description: 'Set spec priority', kind: 'tool', tool: 'builder.set_priority' },
  { name: 'depends', argHint: '<task> <on>', description: 'Set depends-on', kind: 'tool', tool: 'builder.set_dependencies' },
  { name: 'plan', description: 'Open Plan tab', kind: 'navigate', targetTab: 'plan' },
  { name: 'workflow', description: 'Open Workflow tab', kind: 'navigate', targetTab: 'workflows' },
  { name: 'help', description: 'Show all commands', kind: 'help' },
]

export const MENTION_AGENTS = [
  'Atlas',
  'Builder',
  'Verifier',
  'Designer',
  'Council',
  'Memory',
  'Adela',
] as const
export type MentionAgent = (typeof MENTION_AGENTS)[number]

export interface ParsedSlashCommand {
  command: SlashCommand
  args: string
  raw: string
}

/**
 * Parse a leading slash command from a chat input. Returns null if the input
 * does NOT start with `/<letter>` (so literal `/foo/bar` paths and
 * mid-message slashes are passed straight through to chat).
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trimStart()
  // Risk mitigation: only trigger if `/` is at position 0 of the trimmed
  // input AND followed by an ASCII letter — that excludes file paths.
  if (!/^\/[a-zA-Z]/.test(trimmed)) return null
  const match = trimmed.match(/^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  const name = match[1].toLowerCase()
  const command = SLASH_COMMANDS.find((c) => c.name === name)
  if (!command) return null
  return { command, args: (match[2] ?? '').trim(), raw: trimmed }
}

/** True if the input *might* still be a slash command being typed. */
export function looksLikeSlashStart(input: string): boolean {
  return /^\/[a-zA-Z]*$/.test(input.trimStart())
}

/** Filter the registry by what the user has typed so far (e.g. `/qu`). */
export function filterCommands(query: string): SlashCommand[] {
  const q = query.replace(/^\//, '').toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q))
}

/** Human-readable signature shown in the menu (e.g. `/spec <phase>`). */
export function commandSignature(c: SlashCommand): string {
  return `/${c.name}${c.argHint ? ` ${c.argHint}` : ''}`
}
