---
priority: 3
source: atlas-plan-tree
---

# Task: phase-575e1b6f67342d6a021c3c2b4069269d6d081b10-designer-followup.md

# Designer audit follow-up — 575e1b6f67342d6a021c3c2b4069269d6d081b10

4 cosmetic gaps flagged by the designer. All are auto-fixable.

## Gaps
- [low] motion: src/components/atlas/CockpitChat.tsx:296 hover: class without transition- — abrupt state change
- [low] motion: src/components/atlas/CockpitChat.tsx:321 hover: class without transition- — abrupt state change
- [medium] motion: CockpitChat.tsx:296 has hover: class without transition- property — creates abrupt state change instead of smooth transition required by design system
- [medium] motion: CockpitChat.tsx:321 has hover: class without transition- property — creates abrupt state change instead of smooth transition required by design system

## Remediations
  - Add transition-colors duration-200 (or similar) for smooth state changes
  - Add transition-colors duration-200 (or similar) for smooth state changes
  - Add transition-colors duration-200 to the className of the interactive element at line 296
  - Add transition-colors duration-200 to the className of the interactive element at line 321

## Constraints
- Touch only files referenced in the gap objects.
- Use existing shadcn/ui + lucide-react components and Tailwind utilities already in the file.
- Run `npm run build` before committing.


## Source plan node

- Phase hint: designer-followup
- Generated: 2026-05-02T09:34:08.227Z
