# Task: <short-name> — <one-line summary>

**Master plan reference:** section X.Y
**V3-CODING-INSTRUCTIONS reference:** section X
**Estimated effort:** <hours/days>

---

## Goal

<one paragraph: what problem does this solve, and what's the desired end state?>

## In scope

### <category 1, e.g. Pages>
- file path 1 — what changes
- file path 2 — what changes

### <category 2, e.g. Components>
- ...

### <category 3, e.g. Schema additions>
- new table / column / migration name

## Out of scope

- thing 1 (deferred to phase Y.Z)
- thing 2 (NEVER built — see master plan section 11)

## Acceptance criteria

1. ...
2. ...
3. `npm run build` passes
4. Conventional commits, one per logical chunk

## Foundation check (do this BEFORE starting)

Before implementing, verify these exist:
- ✅ table X with columns ...
- ✅ ...

If any are missing, STOP and write `.agent/questions/<task-id>-q.md` with the gap.

## Suggested order

1. ...
2. ...

## Notes

- watch out for ...
- pattern to follow: ...

---

**Done condition:** all acceptance criteria met, build green, commit message references this task ID.
