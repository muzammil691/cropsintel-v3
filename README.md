# CropsIntel V3

Clean rebuild of CropsIntel — almond market intelligence platform with CRM/BRM/SRM
relationship graphs, autonomous data pipelines, and an AI agent layer (Zyra, Atlas,
Adela). Pilot commodity is almonds; multi-commodity expansion built into the schema
from day one.

**Status:** Phase 1 in progress (Market Intelligence MVP).
**Master plan:** `~/Documents/Claude/Projects/Cropsintel/cropsintel-v3-master-plan.md`
**Source of truth:** the master plan. Read it before starting any V3 work session.

---

## Stack

- Vite 8 + React 19 + TypeScript 6
- Tailwind 4 + shadcn/ui (Radix preset, Nova theme — Lucide icons + Geist font)
- Supabase (Postgres + Auth + Storage + Edge Functions) — project `hzrnohsxigrqlmzegwlb`, region Singapore
- React Router 7 (lazy-loaded routes) + Tanstack Query 5 + Zustand 5
- React Hook Form + Zod for forms (Phase 2+)
- i18next (multi-language; EN+HI+ZH+AR+UR launch set per master plan 1.12)
- Playwright + Vitest for tests

## Architecture (high level)

V3 is **CropsIntel standalone** (per master plan v1.2). It does NOT integrate with the
adjacent MAXONS Trading App or Microsoft Business Central. The MAXONS Workflow doc is
knowledge reference only — V3's intelligence is grounded in real almond-trading process
knowledge, but V3 doesn't execute trading workflows. See `docs/SCOPE.md` for the full
in/out-of-scope list.

Three named layers:
- **Adela** — runtime nervous system (cron-driven Node runner, Phase 1.6)
- **Atlas** — self-development orchestrator (Phase 2.11–2.12)
- **Zyra** — customer-facing intelligence agent (Phase 1.10)

Three relationship graphs (the spine):
- **CRM** — customers (importers/buyers)
- **BRM** — brokers
- **SRM** — suppliers

Information walls between them are load-bearing.

## Local development

### Prereqs
- Node 22+ (LTS)
- VS Code with ESLint + Prettier + Tailwind CSS IntelliSense + GitLens + GitHub PR extensions
- A `.env.local` file with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`

### Run dev server
```bash
npm run dev      # http://localhost:5173
npm run build    # production build
npm run preview  # preview built bundle
```

### Apply migrations to Supabase
```bash
npx supabase login
npx supabase link --project-ref hzrnohsxigrqlmzegwlb
npx supabase db push
```

### Generate types
```bash
npx supabase gen types typescript \
  --project-id hzrnohsxigrqlmzegwlb \
  > src/lib/database.types.ts
```

## Project layout

```
cropsintel-v3/
├── .github/workflows/deploy.yml    # GitHub Pages auto-deploy on push to main
├── public/
│   └── CNAME                        # cropsintel.com
├── src/
│   ├── components/
│   │   ├── RouteGuard.tsx           # 3-tier RBAC at route layer
│   │   └── ui/                      # shadcn components (button, input, dialog, …)
│   ├── contexts/
│   │   └── AuthContext.tsx          # Supabase session + profile + roles provider
│   ├── hooks/
│   │   └── useAuth.ts               # consume AuthContext
│   ├── lib/
│   │   ├── supabase.ts              # Supabase client (anon/publishable key)
│   │   ├── database.types.ts        # TS types matching the migration
│   │   └── utils.ts                 # shadcn cn() helper
│   ├── pages/
│   │   ├── Welcome.tsx              # public landing
│   │   ├── Auth.tsx                 # 4-method login (stub for Phase 1.3)
│   │   ├── Dashboard.tsx            # auth-required dashboard (stub for Phase 1.9)
│   │   └── NotFound.tsx             # 404
│   ├── App.tsx                      # route table
│   ├── main.tsx                     # providers + root
│   └── index.css                    # Tailwind 4 + shadcn theme
├── supabase/
│   └── migrations/                  # SQL migrations (apply via supabase db push)
└── ...
```

## Deployment

Push to `main` triggers `.github/workflows/deploy.yml` which:
1. Checks out the repo
2. Installs deps
3. Builds with the GitHub Actions Secrets injected as `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
4. Uploads `dist/` to GitHub Pages
5. Deploys

Custom domain `cropsintel.com` is configured via `public/CNAME` + the GitHub Pages settings.

## Coding conventions

- TypeScript strict mode (per `tsconfig.app.json`)
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`)
- Lazy-load every page route in `App.tsx`
- Every component touching auth uses `useAuth()` hook
- Every protected route wraps with `<RouteGuard requires="auth|team|admin">`
- Every Supabase query uses the typed client from `@/lib/supabase`
- AI provider keys NEVER appear in `VITE_*` env vars or any client-side code
- All cross-cutting agents write to `agent_audit_log` table

## What's next

See the master plan + `V3-CODING-INSTRUCTIONS.md` for the next-task queue.

## Related repos / projects

- V1 (almond-oracle): `gitlab.com/muzammil69/almond-oracle` — heavyweight Lovable build, parked
- V2 (CropsIntelV2): `github.com/muzammil691/CropsIntelV2` — currently live at cropsintel.com
- MAXONS Trading App: separate, not in V3 scope (per master plan v1.2)

## License

Proprietary. © MAXONS General Trading LLC.
