# Task: Phase 1.7 — GitHub Pages SPA routing fix (404 fallback)

**Master plan reference:** infrastructure fix
**Depends on:** none — this is a quick infra fix
**Estimated effort:** 30 minutes; do this BEFORE Phase 1.6 if possible.

---

## Goal

GitHub Pages doesn't natively support SPA client-side routing. When a user reloads `/dashboard` or `/crm/123`, GitHub returns 404 because no static file exists at that path. We need the SPA404 trick: a `404.html` that redirects to `index.html` while preserving the URL.

## In scope

### Files
- `public/404.html` — copy of `index.html` content with a small inline `<script>` that captures the path and stores it in sessionStorage, then redirects to `/cropsintel-v3/`
- `index.html` (the Vite root) — add an inline `<script>` BEFORE the React root mount that checks sessionStorage for the captured path and uses `history.replaceState` to restore it

The standard implementation is documented at https://github.com/rafgraph/spa-github-pages — follow that pattern.

### Update build workflow if needed
- Confirm `.github/workflows/deploy.yml` copies `public/404.html` to the build output (Vite does this by default for files in `public/`, so this should "just work")

## Acceptance criteria

1. Reloading https://muzammil691.github.io/cropsintel-v3/dashboard returns the dashboard, not 404
2. Sharing a deep link like /crm/abc123 works when opened cold in a new browser
3. URL bar shows the correct path after the SPA redirect resolves
4. `npm run build` passes

## Notes
- After cropsintel.com custom domain is wired up with a DNS A record + CNAME file, the base path changes from `/cropsintel-v3/` to `/`. Be parametric where possible.
- Vite's `BASE_URL` is available at build time via `import.meta.env.BASE_URL`

---

**Done condition:** deep links work on the deployed Pages site, build green.
