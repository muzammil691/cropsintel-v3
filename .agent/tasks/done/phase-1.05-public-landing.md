# Task: Phase 1.5 — Public landing + market-insight pages

**Master plan reference:** v1.5 section 11.2 row 1.5
**Depends on:** Phase 1.4 RBAC
**Estimated effort:** ~6 hours
**Model:** claude-opus-4-7

model: claude-opus-4-7

---

## Goal

The first thing the world sees. Per master plan section 1.7 (multi-portal), the **Public** portal shows: landing, market insight previews, news. A teaser of the product's value to drive signups. Verified-only depth lives behind the wall.

## In scope

### Pages
- `src/pages/public/Landing.tsx` — replace the current Welcome page. Hero section explains CropsIntel = "Almond market intelligence + CRM for global traders". 3-up section showcasing pillars (Market Intelligence / Relationship Graph / Prescription Engine). CTA: Sign up → Auth.
- `src/pages/public/MarketInsight.tsx` — `/insights` — public preview. Shows the LATEST market price (one number, big), the % move 1d/7d/30d, and 3 recent news headlines. Below that, an info wall: "Subscribe to see all 9 varieties, broker pricing, and prescriptions."
- `src/pages/public/News.tsx` — `/news` — paginated list of news entries. Public sees title + date + first 200 chars + "Subscribe to read more" wall.
- `src/pages/public/About.tsx` — `/about` — what CropsIntel is, who it's for (importers, brokers, suppliers, MAXONS team), how it differs from raw data feeds.
- `src/pages/Pricing.tsx` — `/pricing` — placeholder showing tiers (Public / Verified / Team), "Contact sales" CTA. Real pricing model is Phase 4.
- `src/pages/UpgradePending.tsx` — `/upgrade-pending` — shown when registered user tries to access verified-only routes. Explains the manual review process.

### Components
- `src/components/public/Hero.tsx`
- `src/components/public/PillarCard.tsx`
- `src/components/public/InfoWallTeaser.tsx` — generic "subscribe to see X" CTA used across public previews
- `src/components/layout/PublicTopbar.tsx` — separate from authenticated AppShell; just logo + nav links + Sign in/up

### Data
- Read from `market_intelligence` table (created in Phase 1.2 migrations) — display whatever's there. If the table is empty, show "Data refreshing — check back shortly" rather than crashing. (Phase 1.7 will fill this with V1 data; Phase 1.6 will keep it fresh with Adela.)

### SEO / Helmet
- Set `<title>` per page using `react-helmet-async`
- Open Graph meta tags for sharing (og:title, og:description, og:image)
- Sitemap: write a `public/sitemap.xml` with all public routes

## Out of scope

- A blog / CMS (Phase 2 maybe; content lives in `news` table)
- i18n on landing (Phase 1.12)
- 3D / heavy animations (per master plan section 11.2 footer — defer Three.js)
- Animated charts on the public preview (Phase 2)

## Acceptance criteria

1. Landing page renders cleanly at `/` for unauthenticated visitors
2. `/insights`, `/news`, `/about`, `/pricing` all render without crashing even with empty DB tables
3. InfoWallTeaser shows on public preview routes pointing registered users to upgrade
4. SEO: title + meta description + OG tags set correctly per page (verify with View Page Source)
5. Mobile responsive (test at 375px, 768px, 1280px)
6. Dark mode support (since shadcn defaults dark)
7. Lighthouse Performance ≥80, Accessibility ≥95
8. `npm run build` passes

## Foundation check (BEFORE starting)
- Verify Phase 1.4 RBAC shipped — RouteGuard tier="public" should work
- Verify Vite base path is set correctly for GitHub Pages
- Verify `market_intelligence` and `news` tables exist (from Phase 1.2)

## Notes
- shadcn components: `card`, `separator`, `button`, `badge`, `accordion` (for FAQ on landing)
- Color palette: stick with shadcn's neutral palette. Avoid making this look generic/template-y. Use a single accent color (Tailwind's emerald-500 or amber-500 — almond-themed).
- Copy quality: this is the first impression. Spend extra time on clarity > cleverness. Reference V1's `Index.tsx` for tone.
- Don't ship lorem ipsum. If you don't have a real number to show, show "—" not "$X.XX" placeholder.

---

**Done condition:** unauthenticated visitor lands on a credible-looking site with real meta tags, clear value prop, working CTAs to sign up. No broken images, no 404s on linked pages, no blank states without graceful fallbacks.
