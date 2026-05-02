# Task: Phase 1.10an-remediation-2 — Atlas Cockpit UI Component Tree

**Master plan reference:** §6.3 conductor shell; §9.1 chat UX scroll contract; §11.2 rows 1.10a–1.10n
**Context:** Verifier identified 13 missing files in the Atlas Cockpit conductor UI. The split-pane shell exists in skeleton form but the full component tree, tab panels, slash command menu, artifact cards, and mention picker are absent. This remediation builds all 13 files so the Cockpit is fully navigable and the chat scroll regression is permanently fixed.
**Estimated effort:** ~90 min Builder time

---

## Goal

1. Create `AtlasCockpit.tsx` — h-screen overflow-hidden split-pane root. NEVER allows page scroll.
2. Create `AtlasHeader.tsx` — 48px top bar with agent health dots (Builder/Verifier/Council/Designer/Adela), session cost, trust-mode badge.
3. Create `AtlasTabPanel.tsx` — tab strip: Plan / Queue / Agents / Audit / Workflows / Artifacts.
4. Create `AtlasPlanTab.tsx` — collapsible master-plan tree from hardcoded PLAN constant, full-text search, click-to-sheet drawer with Start Build / Discuss / Add to Queue buttons.
5. Create `AtlasQueueTab.tsx` — placeholder accepting optional queueItems prop.
6. Create `AtlasAgentsTab.tsx` — 5 agent cards: Builder=active, Verifier=error, Council=broken, Designer=active, Adela=active.
7. Create `AtlasAuditTab.tsx` — placeholder scaffold.
8. Create `AtlasWorkflowTab.tsx` — placeholder scaffold.
9. Create `AtlasArtifactsTab.tsx` — placeholder scaffold.
10. Create `SlashCommandMenu.tsx` — shadcn Popover on / keypress, 8 commands, keyboard-navigable.
11. Create `ArtifactCardInChat.tsx` — success (green border) + error (red border) states with Diagnose / Copy Fix / Retry buttons.
12. Create `MentionMenu.tsx` — shadcn Popover on @ keypress, 5 agents, keyboard-navigable.
13. Create `atlas-slash-commands.ts` — SlashCommand type + SLASH_COMMANDS[8] array.
14. Create `atlas-plan-data.ts` — PlanNode type + PLAN constant with all master plan phases.
15. Fix scroll contract globally: root h-screen overflow-hidden, split pane flex-1 min-h-0, message list overflow-y-auto min-h-0, input bar shrink-0.

---

## Architecture

```
src/components/atlas/
  AtlasCockpit.tsx
  AtlasHeader.tsx
  AtlasTabPanel.tsx
  tabs/
    AtlasPlanTab.tsx
    AtlasQueueTab.tsx
    AtlasAgentsTab.tsx
    AtlasAuditTab.tsx
    AtlasWorkflowTab.tsx
    AtlasArtifactsTab.tsx
  chat/
    SlashCommandMenu.tsx
    ArtifactCardInChat.tsx
    MentionMenu.tsx
  lib/
    atlas-slash-commands.ts
    atlas-plan-data.ts
```

Layout scroll contract:
- AtlasCockpit: h-screen overflow-hidden flex flex-col
- AtlasHeader: h-12 shrink-0
- Split pane: flex-1 min-h-0 flex
- Left aside: flex flex-col min-h-0
- Tab content: flex-1 min-h-0 overflow-y-auto
- Message list: flex-1 min-h-0 overflow-y-auto
- Input bar: shrink-0

---

## Files

- `src/components/atlas/AtlasCockpit.tsx` (NEW)
- `src/components/atlas/AtlasHeader.tsx` (NEW)
- `src/components/atlas/AtlasTabPanel.tsx` (NEW)
- `src/components/atlas/tabs/AtlasPlanTab.tsx` (NEW)
- `src/components/atlas/tabs/AtlasQueueTab.tsx` (NEW)
- `src/components/atlas/tabs/AtlasAgentsTab.tsx` (NEW)
- `src/components/atlas/tabs/AtlasAuditTab.tsx` (NEW)
- `src/components/atlas/tabs/AtlasWorkflowTab.tsx` (NEW)
- `src/components/atlas/tabs/AtlasArtifactsTab.tsx` (NEW)
- `src/components/atlas/chat/SlashCommandMenu.tsx` (NEW)
- `src/components/atlas/chat/ArtifactCardInChat.tsx` (NEW)
- `src/components/atlas/chat/MentionMenu.tsx` (NEW)
- `src/components/atlas/lib/atlas-slash-commands.ts` (NEW)
- `src/components/atlas/lib/atlas-plan-data.ts` (NEW)

---

## Schema additions

None required for this task.

---

## Success criteria

- `npm run build` exits 0 with zero TypeScript errors after all files are written
- `/atlas` page does not scroll at the page level — only the message list and tab content scroll internally
- Plan tab renders a collapsible tree with all Phase 1/2/3 nodes visible
- Clicking any plan node opens a shadcn Sheet with Start Build / Discuss / Add to Queue buttons
- Search input in Plan tab filters nodes by title in real time
- Agent tab shows 5 cards with correct hardcoded statuses
- Slash command menu appears on / keypress, closes on Escape
- Mention menu appears on @ keypress, closes on Escape
- ArtifactCardInChat renders green border for success, red border for error
- No hex colours, no inline style objects, no custom CSS anywhere

---

## Risks + mitigations

- **Risk:** Existing AtlasChatPanel.tsx may conflict with new AtlasCockpit.tsx shell. **Mitigation:** Read existing file first; wrap or replace as needed; do not duplicate the shell.
- **Risk:** Tailwind 4 flex/min-h-0 scroll containment requires all ancestors to have min-h-0. **Mitigation:** Apply min-h-0 to every flex ancestor in the chain, not just the scroll container.
- **Risk:** shadcn Collapsible may not be installed. **Mitigation:** Check components/ui/ first; if missing use a useState open/closed toggle with ChevronRight/ChevronDown icon instead.
- **Risk:** Council is broken (404). **Mitigation:** This spec was drafted without Council — proceed with Builder directly.

---

## NEVER list

- Never use hex colour literals anywhere
- Never use inline style={{}} attributes
- Never let the root page element scroll — only designated inner containers scroll
- Never import icons from anywhere except lucide-react
- Never import UI components from anywhere except @/components/ui (shadcn)
- Never invent marketing copy or placeholder text beyond what is specified
- Never skip `npm run build` verification after each file
