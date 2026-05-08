# CLAUDE.md — project-specific Claude Code instructions

This file holds project-level rules for Claude Code (and Atlas, when it acts
through Claude Code) when working in this repository. Rules here override
defaults; the project owner has reviewed and approved each one.

## Git workflow

When the user asks to commit or push changes, ALWAYS execute `git push origin main`
as the final step UNLESS the user explicitly says "commit only, do not push". After
pushing, confirm by running `git log -1 --oneline` and showing the output. The
phrase "stop after pushing" means stop AFTER the push command runs successfully,
not before it.
