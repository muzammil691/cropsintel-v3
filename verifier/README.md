# CropsIntel V3 — Verification Agent

Automated quality gate for the autonomous development pipeline. Runs after every "shipped" task and verifies the code against the spec's acceptance criteria.

## Why this exists

The build-green gate alone isn't enough. Previous "shipped" tasks contained stubs that compiled fine but didn't satisfy the spec. This agent catches that gap.

**AI separation principle:** The Builder is Claude Opus 4.7. The Verifier deliberately uses OpenAI o3 + Gemini 2.5 Pro (never Claude) — sharing the same AI brain for build and review produces blindspots. Independent models = independent failure modes.

## Quick start

```bash
cd verifier
npm install
npm run build
npm run audit:all                    # audit all done tasks
npm run audit phase-1.04-rbac       # audit one task
```

## Checks performed

1. **files-exist** — Every file the spec required exists on disk
2. **stub-detector** — No stub patterns (`<NotImplemented>`, `// STUB`, `coming soon`, etc.)
3. **migrations-applied** — Required DB tables exist in `supabase/migrations/` SQL files
4. **routes-wired** — Routes mentioned in spec are in `src/App.tsx` and NOT pointing to `<NotImplemented>`
5. **tests-exist** — Test files exist when spec requires them
6. **deps-installed** — Required npm packages are in `package.json`
7. **components-implemented** — Components have real code, not minimal boilerplate
8. **e2e-smoke** — Playwright smoke test (only if `playwright.config.ts` exists)

If all programmatic checks pass, two AI models review independently:
- **OpenAI o3** — Deep reasoning model; catches subtle spec violations
- **Gemini 2.5 Pro** — Large context (can hold entire repo + spec)
- Disagreement → **GPT-4o judge** tiebreaks (still not Claude)

## Deploy as 4th Railway service

1. In Railway, create a new service from the `cropsintel-v3` repo
2. Set **Root Directory** to `verifier/`
3. Set **Start Command** to `node dist/index.js gate`
4. Set **Build Command** to `npm ci && npm run build`
5. Add environment variables (table below)
6. Railway crons the container — it wakes, checks for unverified done tasks, runs verification, queues remediation if gaps found

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key (o3 judgment + GPT-4o council tiebreak) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key (Gemini 2.5 Pro large-context review) |
| `SUPABASE_URL` | Yes | V3 Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service-role key (bypasses RLS for audit writes) |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio SID for WhatsApp gap notifications |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio auth token |
| `TWILIO_WHATSAPP_FROM` | Optional | Twilio WhatsApp sender number (e.g. `+14155238886`) |
| `NOTIFY_WHATSAPP_TO` | Optional | Recipient WhatsApp number (e.g. `+447700900000`) |
| `REPO_ROOT` | Auto | Absolute path to the V3 repo root (default: parent of `verifier/`) |

## Modes

### `audit` — verify one task
```bash
npm run audit phase-1.04-rbac
```
Reads the task spec from `.agent/tasks/done/phase-1.04-rbac.md`, runs all checks, prints gap report.

### `audit-all` — verify all done tasks
```bash
npm run audit:all
```
Iterates every `.md` in `.agent/tasks/done/`, runs `audit` on each, prints summary.

### `gate` — cron mode (production)
```bash
npm run gate
# or with explicit args:
node dist/index.js gate --task-spec .agent/tasks/in-progress/phase-1.xx.md --commit-sha abc123
```
Finds unverified done tasks, verifies them, and either:
- **PASS** → records `verifier_runs` row, moves on
- **FAIL** → creates remediation task in `.agent/tasks/queued/`, sends WhatsApp, exits 1

## Remediation flow

When gaps are found, the agent creates a remediation task file at:
```
.agent/tasks/queued/<task-id>-remediation-<timestamp>.md
```
This file contains the original spec + the gap report. The dev-time agent picks it up on the next loop iteration and fixes the specific gaps.

## Running tests

```bash
npm test
```
Each of the 7 programmatic checks has both a passing and failing test case.

<!-- smoke test phase-test-verifier-fix verified verifier audit path -->
